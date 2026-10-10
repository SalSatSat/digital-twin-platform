import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Engine,
  ReflectionError,
  affectsComponent,
  type ComponentKindName,
} from "@dt-platform/renderer";

export function useComponentField<T>(
  engine: Engine,
  handle: number,
  kind: ComponentKindName,
) {
  // The engine is the source of truth, read through useSyncExternalStore: it
  // subscribes to the engine's change events (ADR-036) and re-checks the
  // snapshot after subscribing, so nothing falls between render and
  // subscription. Edits made elsewhere (the gizmo, a reparent) show up in
  // place, with no remount: a remount would also fire for the echo of our own
  // write and steal focus mid-typing. NumberField does not overwrite its text
  // while focused. The snapshot is a string, so an identical re-read (such as
  // the echo of our own write) does not re-render.
  const subscribe = useCallback(
    (onChange: () => void) =>
      engine.events.subscribe((batch) => {
        if (affectsComponent(batch, handle, kind)) onChange();
      }),
    [engine, handle, kind],
  );
  const getSnapshot = useCallback(
    () => engine.getComponentJson(handle, kind) || null,
    [engine, handle, kind],
  );
  const engineJson = useSyncExternalStore(subscribe, getSnapshot);

  // The user's edit that has not been written to the engine yet. While it
  // exists it wins over the engine's value; it is cleared once the debounced
  // write succeeds, and kept if the write is rejected so the typed value stays
  // visible next to the error.
  const [pendingJson, setPendingJson] = useState<string | null>(null);
  const json = pendingJson ?? engineJson;
  const value = useMemo<T | null>(
    () => (json ? (JSON.parse(json) as T) : null),
    [json],
  );
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup only: cancel a pending debounced write if this field renderer
  // unmounts (e.g. the user switches entity handle) before it fires.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function updateValue(next: T) {
    setPendingJson(JSON.stringify(next));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      try {
        engine.setComponentJson(handle, kind, JSON.stringify(next));
        setError(null);
        setPendingJson(null);
      } catch (e) {
        if (e instanceof ReflectionError) {
          setError(e.message);
        } else {
          throw e;
        }
      }
    }, 500);
  }

  return { value, setValue: updateValue, error };
}
