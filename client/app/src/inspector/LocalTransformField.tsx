import { useComponentField } from "./useComponentField";
import { NumberField } from "./NumberField";
import type { FieldRendererProps } from "./FieldRenderer";

type Vec3 = [number, number, number];

/** Wire shape of LocalTransformView (engine/wasm/src/reflection.rs). */
interface LocalTransformValue {
  position: Vec3;
  rotation_euler_deg: Vec3;
  /**
   * Per-axis, finite and non-zero; negative mirrors (ADR-039). The engine
   * rejects 0 with a message naming the axis, and the field returns to the
   * engine's value. There is no proportional lock yet.
   */
  scale: Vec3;
}

type Vec3Field = "position" | "rotation_euler_deg" | "scale";

const AXES = ["X", "Y", "Z"] as const;
const axisColors = ["text-red-400", "text-green-400", "text-blue-400"];

export function LocalTransformField({ engine, handle }: FieldRendererProps) {
  const { value, setValue, error } = useComponentField<LocalTransformValue>(
    engine,
    handle,
    "LocalTransform",
  );
  if (!value) return null;

  // The whole view is always written back, so every field round-trips
  // (LocalTransformView is strict: a missing field is rejected).
  function setAxis(field: Vec3Field, index: number, next: number) {
    const updated: Vec3 = [...value![field]];
    updated[index] = next;
    setValue({ ...value!, [field]: updated });
  }

  return (
    <div>
      <AxisRow
        label="Position"
        values={value.position}
        onChange={(i, next) => setAxis("position", i, next)}
      />
      <AxisRow
        label="Rotation"
        values={value.rotation_euler_deg}
        onChange={(i, next) => setAxis("rotation_euler_deg", i, next)}
        className="mt-1"
      />
      <AxisRow
        label="Scale"
        values={value.scale}
        onChange={(i, next) => setAxis("scale", i, next)}
        className="mt-1"
      />
      {error && <p className="text-text-error text-xs mt-1">{error}</p>}
    </div>
  );
}

interface AxisRowProps {
  label: string;
  values: Readonly<Vec3>;
  onChange: (index: number, next: number) => void;
  className?: string;
}

/** A labelled row of three number fields, X Y Z. */
function AxisRow({ label, values, onChange, className = "" }: AxisRowProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm text-text-primary w-20 shrink-0">{label}</span>
      <div className="flex-1 grid grid-cols-3 gap-1">
        {AXES.map((axis, i) => (
          <label key={axis} className="flex items-center gap-1 min-w-0">
            <span className={`text-xs font-semibold shrink-0 ${axisColors[i]}`}>
              {axis}
            </span>
            <NumberField
              value={values[i]}
              onChange={(next) => onChange(i, next)}
              className="w-full min-w-0 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary text-sm focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
