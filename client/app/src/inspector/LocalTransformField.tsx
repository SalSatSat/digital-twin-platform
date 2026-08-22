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
      <strong className="text-xs font-semibold text-text-muted uppercase tracking-wide">
        Transform
      </strong>
      <div className="mt-1">
        <div className="text-xs text-text-muted mb-1">Position</div>
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis, i) => (
            <label
              key={axis}
              className="flex items-center gap-1 text-sm text-text-primary min-w-0"
            >
              <span className="shrink-0">{axis}:</span>
              <input
                type="number"
                value={value.position[i]}
                onChange={(e) =>
                  setPositionAxis(i as 0 | 1 | 2, Number(e.target.value))
                }
                className="w-full min-w-0 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </label>
          ))}
        </div>
      </div>
      <div className="mt-1">
        <div className="text-xs text-text-muted mb-1">
          Rotation (degrees, pitch/yaw/roll)
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["pitch", "yaw", "roll"] as const).map((axis, i) => (
            <label
              key={axis}
              className="flex items-center gap-1 text-sm text-text-primary min-w-0"
            >
              <span className="shrink-0">{axis}:</span>
              <input
                type="number"
                value={value.rotation_euler_deg[i]}
                onChange={(e) =>
                  setRotationAxis(i as 0 | 1 | 2, Number(e.target.value))
                }
                className="w-full min-w-0 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </label>
          ))}
        </div>
      </div>
      {error && <p className="text-text-error text-xs mt-1">{error}</p>}
    </div>
  );
}
