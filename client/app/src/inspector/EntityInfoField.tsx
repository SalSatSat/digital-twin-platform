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
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => setValue({ ...value!, enabled: e.target.checked })}
          className="accent-accent shrink-0"
        />
        <input
          type="text"
          value={value.name}
          onChange={(e) => setValue({ ...value!, name: e.target.value })}
          className="flex-1 min-w-0 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
        />
        <label className="flex items-center gap-1 text-sm text-text-primary shrink-0">
          <input
            type="checkbox"
            checked={value.visible}
            onChange={(e) => setValue({ ...value!, visible: e.target.checked })}
            className="accent-accent"
          />
          Visible
        </label>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xs text-text-muted shrink-0">Category</span>
        <select
          value={value.category}
          onChange={(e) => setValue({ ...value!, category: e.target.value })}
          className="w-20 bg-surface-raised border border-border rounded px-1 py-0.5 text-xs text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1">
        <div className="text-xs text-text-muted mb-1">Contexts</div>
        <div className="flex flex-wrap gap-1">
          {contexts.map((c) => {
            const active = value.contexts.includes(c.name);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleContext(c.name)}
                className={
                  active
                    ? "px-2 py-0.5 rounded text-xs border border-accent bg-accent/20 text-accent"
                    : "px-2 py-0.5 rounded text-xs border border-border bg-surface-raised text-text-muted"
                }
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="text-text-error text-xs mt-1">{error}</p>}
    </div>
  );
}
