import { useEffect, useRef, useState } from "react";
import { Engine, ReflectionError } from "@dt-platform/renderer";

export function useComponentField<T>(
  engine: Engine,
  handle: number,
  kind: string,
) {
  const [value, setValue] = useState<T | null>(() => {
    const json = engine.getComponentJson(handle, kind);
    return json ? (JSON.parse(json) as T) : null;
  });
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup only — cancel a pending debounced write if this field
  // renderer unmounts (e.g. the user switches entity handle) before
  // it fires.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function updateValue(next: T) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        engine.setComponentJson(handle, kind, JSON.stringify(next));
        setError(null);
        const json = engine.getComponentJson(handle, kind);
        setValue(json ? (JSON.parse(json) as T) : null);
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
