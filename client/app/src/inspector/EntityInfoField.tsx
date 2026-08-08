import { useState } from "react";
import { useComponentField } from "./useComponentField";
import type { FieldRendererProps } from "./FieldRenderer";

interface EntityInfoValue {
  id: string;
  name: string;
  enabled: boolean;
  visible: boolean;
  category: string;
  contexts: string[];
}

interface CategoryDef {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  is_builtin: boolean;
}

interface ContextDef {
  id: string;
  name: string;
  description: string;
  color: string | null;
  is_builtin: boolean;
}

export function EntityInfoField({ engine, handle }: FieldRendererProps) {
  const { value, setValue, error } = useComponentField<EntityInfoValue>(
    engine,
    handle,
    "EntityInfo",
  );

  // Registry data — not per-entity, doesn't depend on handle. Fetched
  // once via a lazy initializer (same "synchronous WASM call, no
  // useEffect needed" reasoning as useComponentField).
  const [categories] = useState<CategoryDef[]>(
    () => JSON.parse(engine.listCategories()) as CategoryDef[],
  );
  const [contexts] = useState<ContextDef[]>(
    () => JSON.parse(engine.listContexts()) as ContextDef[],
  );

  if (!value) return null;

  function toggleContext(name: string) {
    const has = value!.contexts.includes(name);
    const updated = has
      ? value!.contexts.filter((c) => c !== name)
      : [...value!.contexts, name];
    setValue({ ...value!, contexts: updated });
  }

  return (
    <div>
      <strong>Entity Info</strong>
      <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
        ID: {value.id}
      </div>
      <div style={{ marginTop: 4 }}>
        <label>
          Name:{" "}
          <input
            type="text"
            value={value.name}
            onChange={(e) => setValue({ ...value!, name: e.target.value })}
          />
        </label>
      </div>
      <div style={{ marginTop: 4, display: "flex", gap: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => setValue({ ...value!, enabled: e.target.checked })}
          />{" "}
          Enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.visible}
            onChange={(e) => setValue({ ...value!, visible: e.target.checked })}
          />{" "}
          Visible
        </label>
      </div>
      <div style={{ marginTop: 4 }}>
        <label>
          Category:{" "}
          <select
            value={value.category}
            onChange={(e) => setValue({ ...value!, category: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, color: "#888" }}>Contexts</div>
        {contexts.map((c) => (
          <label key={c.id} style={{ marginRight: 8 }}>
            <input
              type="checkbox"
              checked={value.contexts.includes(c.name)}
              onChange={() => toggleContext(c.name)}
            />{" "}
            {c.name}
          </label>
        ))}
      </div>
      {error && <p style={{ color: "#e57373", margin: "4px 0 0" }}>{error}</p>}
    </div>
  );
}
