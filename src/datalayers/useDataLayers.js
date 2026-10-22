import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { DATA_LAYERS } from './registry';

const STORAGE_KEY = 'worldy.layers';

function loadEnabled() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

/**
 * On/off state for data layers (remembered between visits). A layer is only
 * created — and only fetches data — while it is switched on.
 */
export default function useDataLayers(viewer) {
  const [enabled, setEnabled] = useState(loadEnabled);
  const [version, setVersion] = useState(0);
  const instances = useRef(new Map());

  // Layers call ctx.changed() when counts/status change; batch those into one re-render
  const ctx = useMemo(() => {
    const pending = { timer: null };
    return {
      changed: () => {
        if (pending.timer) return;
        pending.timer = setTimeout(() => {
          pending.timer = null;
          setVersion((v) => v + 1);
        }, 250);
      },
    };
  }, []);

  useEffect(() => {
    if (!viewer) return;
    const live = instances.current;
    for (const def of DATA_LAYERS) {
      const inst = live.get(def.id);
      if (enabled[def.id] && !inst) live.set(def.id, def.create(viewer, ctx));
      else if (!enabled[def.id] && inst) {
        inst.destroy();
        live.delete(def.id);
      }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // ignore
    }
    ctx.changed();
  }, [viewer, enabled, ctx]);

  useEffect(() => {
    const live = instances.current;
    return () => {
      for (const inst of live.values()) inst.destroy();
      live.clear();
    };
  }, [viewer]);

  const toggle = useCallback((id) => setEnabled((e) => ({ ...e, [id]: !e[id] })), []);
  const get = useCallback((id) => instances.current.get(id), []);

  return { enabled, toggle, get, version };
}
