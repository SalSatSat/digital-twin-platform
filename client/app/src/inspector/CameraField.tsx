import { useComponentField } from "./useComponentField";
import { NumberField } from "./NumberField";
import type { FieldRendererProps } from "./FieldRenderer";

interface PerspectiveFields {
  fov_degrees: number;
  near: number;
  far: number;
}
interface OrthographicFields {
  size: number;
  near: number;
  far: number;
}
type ProjectionType =
  | { Perspective: PerspectiveFields }
  | { Orthographic: OrthographicFields };
interface CameraValue {
  projection: ProjectionType;
}

function variantOf(projection: ProjectionType): "Perspective" | "Orthographic" {
  return "Perspective" in projection ? "Perspective" : "Orthographic";
}

export function CameraField({ engine, handle }: FieldRendererProps) {
  const { value, setValue, error } = useComponentField<CameraValue>(
    engine,
    handle,
    "Camera",
  );
  if (!value) return null;
  const variant = variantOf(value.projection);

  function setVariant(next: "Perspective" | "Orthographic") {
    if (next === variant) return;
    const currentNear =
      variant === "Perspective"
        ? (value!.projection as { Perspective: PerspectiveFields }).Perspective
            .near
        : (value!.projection as { Orthographic: OrthographicFields })
            .Orthographic.near;
    const currentFar =
      variant === "Perspective"
        ? (value!.projection as { Perspective: PerspectiveFields }).Perspective
            .far
        : (value!.projection as { Orthographic: OrthographicFields })
            .Orthographic.far;
    setValue({
      projection:
        next === "Perspective"
          ? {
              Perspective: {
                fov_degrees: 75,
                near: currentNear,
                far: currentFar,
              },
            }
          : { Orthographic: { size: 10, near: currentNear, far: currentFar } },
    });
  }
  function updatePerspective(patch: Partial<PerspectiveFields>) {
    const current = (value!.projection as { Perspective: PerspectiveFields })
      .Perspective;
    setValue({ projection: { Perspective: { ...current, ...patch } } });
  }
  function updateOrthographic(patch: Partial<OrthographicFields>) {
    const current = (value!.projection as { Orthographic: OrthographicFields })
      .Orthographic;
    setValue({ projection: { Orthographic: { ...current, ...patch } } });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-primary w-20 shrink-0">
          Projection
        </span>
        <select
          value={variant}
          onChange={(e) =>
            setVariant(e.target.value as "Perspective" | "Orthographic")
          }
          className="w-28 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary text-sm focus:ring-1 focus:ring-accent focus:outline-none"
        >
          <option value="Perspective">Perspective</option>
          <option value="Orthographic">Orthographic</option>
        </select>
      </div>
      {variant === "Perspective" ? (
        <>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-text-primary w-20 shrink-0">FOV</span>
            <NumberField
              value={
                (value.projection as { Perspective: PerspectiveFields })
                  .Perspective.fov_degrees
              }
              onChange={(next) => updatePerspective({ fov_degrees: next })}
              className="w-24 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-text-primary w-20 shrink-0">
              Near
            </span>
            <NumberField
              value={
                (value.projection as { Perspective: PerspectiveFields })
                  .Perspective.near
              }
              onChange={(next) => updatePerspective({ near: next })}
              className="w-24 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-text-primary w-20 shrink-0">Far</span>
            <NumberField
              value={
                (value.projection as { Perspective: PerspectiveFields })
                  .Perspective.far
              }
              onChange={(next) => updatePerspective({ far: next })}
              className="w-24 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-text-primary w-20 shrink-0">
              Size
            </span>
            <NumberField
              value={
                (value.projection as { Orthographic: OrthographicFields })
                  .Orthographic.size
              }
              onChange={(next) => updateOrthographic({ size: next })}
              className="w-24 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-text-primary w-20 shrink-0">
              Near
            </span>
            <NumberField
              value={
                (value.projection as { Orthographic: OrthographicFields })
                  .Orthographic.near
              }
              onChange={(next) => updateOrthographic({ near: next })}
              className="w-24 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-text-primary w-20 shrink-0">Far</span>
            <NumberField
              value={
                (value.projection as { Orthographic: OrthographicFields })
                  .Orthographic.far
              }
              onChange={(next) => updateOrthographic({ far: next })}
              className="w-24 bg-surface-raised border border-border rounded px-1 py-0.5 text-text-primary focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </>
      )}
      {error && <p className="text-text-error text-xs mt-1">{error}</p>}
    </div>
  );
}
