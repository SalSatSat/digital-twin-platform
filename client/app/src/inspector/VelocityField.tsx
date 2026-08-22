import { useComponentField } from "./useComponentField";
import type { FieldRendererProps } from "./FieldRenderer";

interface VelocityValue {
  value: [number, number, number];
}

const axisColors = ["text-red-400", "text-green-400", "text-blue-400"];

export function VelocityField({ engine, handle }: FieldRendererProps) {
  const { value, setValue, error } = useComponentField<VelocityValue>(
    engine,
    handle,
    "Velocity",
  );
  if (!value) return null;
  const [x, y, z] = value.value;

  function setAxis(index: 0 | 1 | 2, next: number) {
    const updated: [number, number, number] = [...value!.value];
    updated[index] = next;
    setValue({ value: updated });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-primary w-20 shrink-0">
          Velocity
        </span>
        <div className="flex-1 grid grid-cols-3 gap-1">
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <label key={axis} className="flex items-center gap-1 min-w-0">
              <span
                className={`text-xs font-semibold shrink-0 ${axisColors[i]}`}
              >
                {axis}
              </span>
              <input
                type="number"
                value={[x, y, z][i]}
                onChange={(e) =>
                  setAxis(i as 0 | 1 | 2, Number(e.target.value))
                }
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
