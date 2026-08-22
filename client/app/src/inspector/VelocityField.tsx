import { useComponentField } from "./useComponentField";
import type { FieldRendererProps } from "./FieldRenderer";

interface VelocityValue {
  value: [number, number, number];
}

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
      <strong className="text-xs font-semibold text-text-muted uppercase tracking-wide">
        Velocity
      </strong>
      <div className="flex gap-2 mt-1">
        {(["x", "y", "z"] as const).map((axis, i) => (
          <label
            key={axis}
            className="flex items-center gap-1 text-sm text-text-primary"
          >
            {axis}:
            <input
              type="number"
              value={[x, y, z][i]}
              onChange={(e) => setAxis(i as 0 | 1 | 2, Number(e.target.value))}
              className="w-15 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </label>
        ))}
      </div>
      {error && <p className="text-text-error text-xs mt-1">{error}</p>}
    </div>
  );
}
