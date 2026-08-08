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
      <strong>Velocity</strong>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {(["x", "y", "z"] as const).map((axis, i) => (
          <label key={axis}>
            {axis}:{" "}
            <input
              type="number"
              value={[x, y, z][i]}
              onChange={(e) => setAxis(i as 0 | 1 | 2, Number(e.target.value))}
              style={{ width: 60 }}
            />
          </label>
        ))}
      </div>
      {error && <p style={{ color: "#e57373", margin: "4px 0 0" }}>{error}</p>}
    </div>
  );
}
