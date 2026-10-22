import { useEffect, useRef, useState } from 'react';
import { ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';

/**
 * Click-to-inspect for data-layer items ({ worldyLayer, key } primitive ids).
 * Flights handle their own picking; clicks are ignored while a drawing tool is active.
 * Returns [picked, setPicked] where picked = { layerId, key } | null.
 */
export default function usePicking(viewer, { onPick, isBusy }) {
  const [picked, setPicked] = useState(null);
  const handlers = useRef({ onPick, isBusy });
  useEffect(() => {
    handlers.current = { onPick, isBusy };
  });

  useEffect(() => {
    if (!viewer) return;
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e) => {
      if (handlers.current.isBusy?.()) return;
      const id = viewer.scene.pick(e.position)?.id;
      if (id?.worldyLayer) {
        setPicked({ layerId: id.worldyLayer, key: id.key });
        handlers.current.onPick?.();
      } else if (!id?.worldyFlight) {
        setPicked(null);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
  }, [viewer]);

  return [picked, setPicked];
}
