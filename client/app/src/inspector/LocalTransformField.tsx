import { useComponentField } from "./useComponentField";
import { NumberField } from "./NumberField";
import type { FieldRendererProps } from "./FieldRenderer";

interface LocalTransformValue {
  position: [number, number, number];
  rotation_euler_deg: [number, number, number];
}

const axisColors = ["text-red-400", "text-green-400", "text-blue-400"];

export function LocalTransformField({ engine, handle }: FieldRendererProps) {
  const { value, setValue, error } = useComponentField<LocalTransformValue>(
    engine,
    handle,
    "LocalTransform",
  );
  if (!value) return null;

  function setPositionAxis(index: 0 | 1 | 2, next: number) {
    const updated: [number, number, number] = [...value!.position];
    updated[index] = next;
    setValue({ ...value!, position: updated });
  }
  function setRotationAxis(index: 0 | 1 | 2, next: number) {
    const updated: [number, number, number] = [...value!.rotation_euler_deg];
    updated[index] = next;
    setValue({ ...value!, rotation_euler_deg: updated });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-primary w-20 shrink-0">
          Position
        </span>
        <div className="flex-1 grid grid-cols-3 gap-1">
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <label key={axis} className="flex items-center gap-1 min-w-0">
              <span
                className={`text-xs font-semibold shrink-0 ${axisColors[i]}`}
              >
                {axis}
              </span>
              <NumberField
                value={value.position[i]}
                onChange={(next) => setPositionAxis(i as 0 | 1 | 2, next)}
                className="w-full min-w-0 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary text-sm focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-sm text-text-primary w-20 shrink-0">
          Rotation
        </span>
        <div className="flex-1 grid grid-cols-3 gap-1">
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <label key={axis} className="flex items-center gap-1 min-w-0">
              <span
                className={`text-xs font-semibold shrink-0 ${axisColors[i]}`}
              >
                {axis}
              </span>
              <NumberField
                value={value.rotation_euler_deg[i]}
                onChange={(next) => setRotationAxis(i as 0 | 1 | 2, next)}
                className="w-full min-w-0 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary text-sm focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </label>
          ))}
        </div>
      </div>
      {error && <p className="text-text-error text-xs mt-1">{error}</p>}
    </div>
  );
}
