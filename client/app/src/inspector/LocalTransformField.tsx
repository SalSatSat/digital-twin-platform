import { useComponentField } from "./useComponentField";
import type { FieldRendererProps } from "./FieldRenderer";

interface LocalTransformValue {
  position: [number, number, number];
  rotation_euler_deg: [number, number, number];
}

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
      <strong>Transform</strong>
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, color: "#888" }}>Position</div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["x", "y", "z"] as const).map((axis, i) => (
            <label key={axis}>
              {axis}:{" "}
              <input
                type="number"
                value={value.position[i]}
                onChange={(e) =>
                  setPositionAxis(i as 0 | 1 | 2, Number(e.target.value))
                }
                style={{ width: 60 }}
              />
            </label>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, color: "#888" }}>
          Rotation (degrees, pitch/yaw/roll)
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["pitch", "yaw", "roll"] as const).map((axis, i) => (
            <label key={axis}>
              {axis}:{" "}
              <input
                type="number"
                value={value.rotation_euler_deg[i]}
                onChange={(e) =>
                  setRotationAxis(i as 0 | 1 | 2, Number(e.target.value))
                }
                style={{ width: 60 }}
              />
            </label>
          ))}
        </div>
      </div>
      {error && <p style={{ color: "#e57373", margin: "4px 0 0" }}>{error}</p>}
    </div>
  );
}
