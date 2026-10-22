import React, { useEffect, useRef } from 'react';
import { Math as CesiumMath } from 'cesium';

/**
 * Navigation controls — compass (click for north-up), zoom in/out, home view.
 */
export default function NavControls({ viewer }) {
  const needleRef = useRef(null);

  // Rotate the compass with the camera heading, without React re-renders
  useEffect(() => {
    if (!viewer) return;
    const update = () => {
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${-CesiumMath.toDegrees(viewer.camera.heading)}deg)`;
      }
    };
    return viewer.scene.postRender.addEventListener(update);
  }, [viewer]);

  const zoomIn = () => {
    if (!viewer) return;
    const camera = viewer.camera;
    camera.zoomIn(camera.positionCartographic.height * 0.3);
  };

  const zoomOut = () => {
    if (!viewer) return;
    const camera = viewer.camera;
    camera.zoomOut(camera.positionCartographic.height * 0.5);
  };

  const goHome = () => {
    if (!viewer) return;
    viewer.camera.flyHome(1.5);
  };

  const northUp = () => {
    if (!viewer) return;
    const camera = viewer.camera;
    camera.flyTo({
      destination: camera.positionWC,
      orientation: {
        heading: 0,
        pitch: camera.pitch,
        roll: 0,
      },
      duration: 0.8,
    });
  };

  return (
    <div className="nav-controls" id="nav-controls">
      <button className="nav-btn compass" onClick={northUp} title="Reset north (N)" id="btn-north">
        <svg ref={needleRef} width="22" height="22" viewBox="0 0 24 24">
          <polygon points="12 2 15.5 12 8.5 12" fill="#f87171" />
          <polygon points="12 22 15.5 12 8.5 12" fill="currentColor" />
        </svg>
      </button>
      <div className="nav-group">
        <button className="nav-btn" onClick={zoomIn} title="Zoom in (+)" id="btn-zoom-in">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button className="nav-btn" onClick={zoomOut} title="Zoom out (−)" id="btn-zoom-out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <button className="nav-btn" onClick={goHome} title="Home view (H)" id="btn-home">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </button>
    </div>
  );
}
