/**
 * Live 3D water surface for the physics engine.
 *
 * One mesh with a vertex per simulation cell. Ground positions and up-vectors are uploaded once
 * (relative to the grid centre for float precision); each frame only the depth and speed
 * attributes change (two Float32 buffer uploads), and the vertex shader lifts every vertex
 * by its depth. The fragment shader colours by depth, whitens fast supercritical flow (foam),
 * fades shallow edges, and adds a sky-reflection sheen from screen-space normals.
 */
import {
  BlendingState,
  BoundingSphere,
  Buffer,
  BufferUsage,
  Cartesian3,
  Color,
  ComponentDatatype,
  DrawCommand,
  Ellipsoid,
  IndexDatatype,
  Matrix4,
  Pass,
  PrimitiveType,
  RenderState,
  ShaderProgram,
  VertexArray,
} from 'cesium';

const VS = `
in vec3 position;
in vec3 up;
in float depth;
in float speed;
in float bed;
uniform float u_lift;
out float v_depth;
out float v_speed;
out float v_bed;
out vec3 v_posEC;
void main() {
  v_depth = depth;
  v_speed = speed;
  v_bed = bed;
  vec3 p = position + up * (depth * u_lift + 0.05);
  vec4 ec = czm_modelView * vec4(p, 1.0);
  v_posEC = ec.xyz;
  gl_Position = czm_projection * ec;
}
`;

const FS = `
in float v_depth;
in float v_speed;
in float v_bed;
in vec3 v_posEC;
uniform vec4 u_shallow;
uniform vec4 u_deep;
uniform float u_maxDepth;
uniform float u_cellSize;
uniform float u_mode;
void main() {
  vec3 n = normalize(cross(dFdx(v_posEC), dFdy(v_posEC)));
  vec3 v = normalize(-v_posEC);
  float fresnel = pow(1.0 - abs(dot(n, v)), 3.0);
  if (u_mode > 0.5 && u_mode < 1.5) {
    // waves: sea cells coloured by surface elevation (crest red, trough blue), land by flood depth
    if (v_bed < 0.0) {
      float eta = v_bed + v_depth;
      float a = clamp(eta / u_maxDepth, -1.0, 1.0);
      vec3 calm = vec3(0.10, 0.22, 0.38);
      vec3 col = a > 0.0 ? mix(calm, vec3(1.0, 0.35, 0.2), a) : mix(calm, vec3(0.2, 0.55, 1.0), -a);
      col += vec3(0.2, 0.25, 0.3) * fresnel;
      out_FragColor = vec4(col, 0.35 + 0.55 * abs(a));
      return;
    }
    if (v_depth < 0.05) discard;
    out_FragColor = vec4(mix(vec3(0.5, 0.85, 1.0), vec3(0.05, 0.25, 0.7), clamp(v_depth / 3.0, 0.0, 1.0)), 0.85);
    return;
  }
  if (u_mode > 1.5 && u_mode < 2.5) {
    // fire: value 1 = burning front, ~0.35 = burnt
    if (v_depth < 0.02) discard;
    vec3 col = v_depth > 0.6 ? mix(vec3(1.0, 0.45, 0.0), vec3(1.0, 0.9, 0.3), fract(v_posEC.x * 0.01)) : vec3(0.12, 0.09, 0.08);
    out_FragColor = vec4(col, v_depth > 0.6 ? 0.95 : 0.8);
    return;
  }
  if (u_mode > 2.5) {
    // plume: concentration (already 0..1 log-scaled)
    if (v_depth < 0.02) discard;
    vec3 col = mix(vec3(0.95, 0.9, 0.6), vec3(0.35, 0.3, 0.3), v_depth);
    out_FragColor = vec4(col, 0.25 + 0.6 * v_depth);
    return;
  }
  if (v_depth < 0.02) discard;
  float t = clamp(v_depth / u_maxDepth, 0.0, 1.0);
  vec3 col = mix(u_shallow.rgb, u_deep.rgb, sqrt(t));
  // Froude number ~ speed / sqrt(g h): supercritical flow breaks into white water
  float fr = v_speed / sqrt(9.81 * max(v_depth, 0.01));
  col = mix(col, vec3(0.92, 0.96, 1.0), smoothstep(0.8, 2.0, fr) * 0.7);
  // sky sheen from the screen-space normal
  col += vec3(0.25, 0.32, 0.4) * fresnel;
  float alpha = smoothstep(0.02, 0.4, v_depth) * mix(0.55, 0.85, t);
  out_FragColor = vec4(col, alpha);
}
`;

export default class WaterSurfacePrimitive {
  /**
   * @param grid { nx, ny, bounds: [w,s,e,n] deg, ground: Float32Array (ellipsoidal heights of cell centres) }
   */
  constructor(grid) {
    this.show = true;
    this.grid = grid;
    this.maxDepth = 3;
    this.lift = 1;
    this.mode = 0; // 0 flood depth, 1 waves (η), 2 fire, 3 plume
    this._depth = new Float32Array(grid.nx * grid.ny);
    this._speed = new Float32Array(grid.nx * grid.ny);
    this._dirty = true;
    this._command = null;
    this._destroyed = false;
  }

  /** New frame from the solver (arrays are copied on the next render). */
  setFrame(depth, speed) {
    this._depth.set(depth);
    if (speed) this._speed.set(speed);
    this._dirty = true;
  }

  _build(context) {
    const { nx, ny, bounds, ground, bed } = this.grid;
    const [w, s, e, n] = bounds;
    const N = nx * ny;
    const centre = Cartesian3.fromDegrees((w + e) / 2, (s + n) / 2, 0);
    const pos = new Float32Array(N * 3);
    const up = new Float32Array(N * 3);
    const p = new Cartesian3();
    const nrm = new Cartesian3();
    let radius = 0;
    for (let y = 0; y < ny; y++) {
      const lat = n - ((y + 0.5) * (n - s)) / ny;
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        const lon = w + ((x + 0.5) * (e - w)) / nx;
        Cartesian3.fromDegrees(lon, lat, ground[i], Ellipsoid.WGS84, p);
        Ellipsoid.WGS84.geodeticSurfaceNormal(p, nrm);
        pos[3 * i] = p.x - centre.x;
        pos[3 * i + 1] = p.y - centre.y;
        pos[3 * i + 2] = p.z - centre.z;
        up[3 * i] = nrm.x;
        up[3 * i + 1] = nrm.y;
        up[3 * i + 2] = nrm.z;
        radius = Math.max(radius, Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]));
      }
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let k = 0;
    for (let y = 0; y < ny - 1; y++)
      for (let x = 0; x < nx - 1; x++) {
        const a = y * nx + x;
        idx[k++] = a;
        idx[k++] = a + nx;
        idx[k++] = a + 1;
        idx[k++] = a + 1;
        idx[k++] = a + nx;
        idx[k++] = a + nx + 1;
      }

    const vb = (typedArray, usage = BufferUsage.STATIC_DRAW) => Buffer.createVertexBuffer({ context, typedArray, usage });
    this._depthBuffer = vb(this._depth, BufferUsage.DYNAMIC_DRAW);
    this._speedBuffer = vb(this._speed, BufferUsage.DYNAMIC_DRAW);
    const attributeLocations = { position: 0, up: 1, depth: 2, speed: 3, bed: 4 };
    const bedArr = new Float32Array(N);
    if (bed) for (let i = 0; i < N; i++) bedArr[i] = bed[i];
    const va = new VertexArray({
      context,
      attributes: [
        { index: 0, vertexBuffer: vb(pos), componentsPerAttribute: 3, componentDatatype: ComponentDatatype.FLOAT },
        { index: 1, vertexBuffer: vb(up), componentsPerAttribute: 3, componentDatatype: ComponentDatatype.FLOAT },
        { index: 2, vertexBuffer: this._depthBuffer, componentsPerAttribute: 1, componentDatatype: ComponentDatatype.FLOAT },
        { index: 3, vertexBuffer: this._speedBuffer, componentsPerAttribute: 1, componentDatatype: ComponentDatatype.FLOAT },
        { index: 4, vertexBuffer: vb(bedArr), componentsPerAttribute: 1, componentDatatype: ComponentDatatype.FLOAT },
      ],
      indexBuffer: Buffer.createIndexBuffer({ context, typedArray: idx, usage: BufferUsage.STATIC_DRAW, indexDatatype: IndexDatatype.UNSIGNED_INT }),
    });
    const shaderProgram = ShaderProgram.fromCache({ context, vertexShaderSource: VS, fragmentShaderSource: FS, attributeLocations });
    const renderState = RenderState.fromCache({
      depthTest: { enabled: true },
      depthMask: false,
      blending: BlendingState.ALPHA_BLEND,
      cull: { enabled: false },
    });
    const [c0, c1] = this.colors || ['#7fd3ff', '#0b3a8c'];
    const shallow = Color.fromCssColorString(c0);
    const deep = Color.fromCssColorString(c1);
    const cellSize = this.grid.cellSize || 10;
    this._command = new DrawCommand({
      vertexArray: va,
      shaderProgram,
      renderState,
      pass: Pass.TRANSLUCENT,
      primitiveType: PrimitiveType.TRIANGLES,
      modelMatrix: Matrix4.fromTranslation(centre),
      boundingVolume: new BoundingSphere(centre, radius + 1000),
      owner: this,
      uniformMap: {
        u_shallow: () => shallow,
        u_deep: () => deep,
        u_maxDepth: () => this.maxDepth,
        u_lift: () => this.lift,
        u_cellSize: () => cellSize,
        u_mode: () => this.mode,
      },
    });
    this._va = va;
  }

  update(frameState) {
    if (!this.show || this._destroyed) return;
    if (!this._command) this._build(frameState.context);
    if (this._dirty) {
      this._depthBuffer.copyFromArrayView(this._depth);
      this._speedBuffer.copyFromArrayView(this._speed);
      this._dirty = false;
    }
    frameState.commandList.push(this._command);
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    this._va?.destroy();
    this._command?.shaderProgram?.destroy();
    this._destroyed = true;
  }
}
