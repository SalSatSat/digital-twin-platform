import { useMemo } from "react";
import {
  componentVariants,
  meshVariantName,
  shapeFields,
  withShapeField,
  type MeshJson,
} from "@dt-platform/renderer";
import { useComponentField } from "./useComponentField";
import { NumberField } from "./NumberField";
import type { FieldRendererProps } from "./FieldRenderer";

export function MeshField({ engine, handle }: FieldRendererProps) {
  const { value, setValue, error } = useComponentField<MeshJson>(
    engine,
    handle,
    "Mesh",
  );
  // The engine owns the shape names and their defaults (ADR-038); this client
  // keeps no copy. They do not change while an engine lives, so read once.
  const variants = useMemo(() => componentVariants(engine, "Mesh"), [engine]);
  if (!value) return null;

  const variant = meshVariantName(value.shape);
  const fields = shapeFields(value.shape);
  // A shape this build does not list (a newer engine) still shows as the
  // current choice instead of the select snapping to its first option.
  const names = variants.map((v) => v.name);
  if (!names.includes(variant)) names.push(variant);

  function setVariant(next: string) {
    if (next === variant) return;
    const chosen = variants.find((v) => v.name === next);
    // The whole component, with the chosen shape at the engine's defaults,
    // goes through the same debounced write as every other edit, so a pending
    // edit to the old shape can never overwrite it.
    if (chosen) setValue(JSON.parse(chosen.defaultJson) as MeshJson);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-primary w-20 shrink-0">Shape</span>
        <select
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
          className="w-28 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary text-sm focus:ring-1 focus:ring-accent focus:outline-none"
        >
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {fields.length === 0 ? (
        <p className="text-text-muted text-xs mt-1">
          No editor for the {variant} shape yet.
        </p>
      ) : (
        fields.map((field) => (
          <div
            key={field.key}
            className="flex items-center justify-between mt-1"
          >
            <span className="text-sm text-text-primary w-20 shrink-0">
              {field.label}
            </span>
            <NumberField
              value={field.value}
              onChange={(next) =>
                setValue({
                  shape: withShapeField(value.shape, field.key, next),
                })
              }
              className="w-24 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        ))
      )}
      {error && <p className="text-text-error text-xs mt-1">{error}</p>}
    </div>
  );
}
