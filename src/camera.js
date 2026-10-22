/**
 * Terrain-aware camera helpers.
 *
 * Heights from geocoders are relative to the ellipsoid; with 3D terrain on,
 * flying to "5 km" above Everest puts the camera inside the mountain.
 * Everything here measures from the ground instead.
 */

import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  sampleTerrainMostDetailed,
} from 'cesium';

/** Minimum clearance kept between the camera and the ground (m). */
const CLEARANCE = 60;

export const hasTerrain = (viewer) => !(viewer.terrainProvider instanceof EllipsoidTerrainProvider);

/** Ground height at a point (0 when terrain is off or unavailable). */
export async function groundHeight(viewer, lon, lat) {
  if (!hasTerrain(viewer)) return 0;
  const carto = Cartographic.fromDegrees(lon, lat);
  try {
    const [p] = await sampleTerrainMostDetailed(viewer.terrainProvider, [carto]);
    if (Number.isFinite(p.height)) return p.height;
  } catch {
    // fall back to the currently loaded tiles
  }
  return viewer.scene.globe.getHeight(carto) ?? 0;
}

/**
 * Fly so the point (lon, lat) is centred, `range` metres away from the ground there,
 * looking down at `pitchDeg`.
 */
export async function flyToSafe(viewer, { lon, lat, range, pitchDeg, heading = 0, duration = 2 }) {
  if (!viewer || viewer.isDestroyed()) return;
  const h = await groundHeight(viewer, lon, lat);
  const pitch = pitchDeg ?? (hasTerrain(viewer) && range < 200_000 ? -35 : -60);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(lon, lat, h), 0), {
    offset: new HeadingPitchRange(heading, CesiumMath.toRadians(pitch), range),
    duration,
  });
}

/**
 * Keep the camera above ground: after any render, if it ended up below the
 * terrain (fly-to, terrain switched on, exaggeration raised) lift it out.
 * Returns a remover.
 */
export function installGroundGuard(viewer) {
  const scene = viewer.scene;
  const scratch = new Cartographic();
  return scene.postRender.addEventListener(() => {
    if (!hasTerrain(viewer)) return;
    const camera = viewer.camera;
    if (!Matrix4.equals(camera.transform, Matrix4.IDENTITY)) return; // follow mode manages itself
    const carto = Cartographic.clone(camera.positionCartographic, scratch);
    const ground = scene.globe.getHeight(carto);
    if (ground === undefined) return;
    const minHeight = ground * scene.verticalExaggeration + CLEARANCE;
    if (carto.height < minHeight) {
      camera.position = Cartesian3.fromRadians(carto.longitude, carto.latitude, minHeight);
      scene.requestRender();
    }
  });
}
