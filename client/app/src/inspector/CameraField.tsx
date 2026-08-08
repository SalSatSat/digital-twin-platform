import { useComponentField } from "./useComponentField";
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
      <strong>Camera</strong>
      <div style={{ marginTop: 4 }}>
        <select
          value={variant}
          onChange={(e) =>
            setVariant(e.target.value as "Perspective" | "Orthographic")
          }
        >
          <option value="Perspective">Perspective</option>
          <option value="Orthographic">Orthographic</option>
        </select>
      </div>

      {variant === "Perspective" ? (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <label>
            FOV:{" "}
            <input
              type="number"
              value={
                (value.projection as { Perspective: PerspectiveFields })
                  .Perspective.fov_degrees
              }
              onChange={(e) =>
                updatePerspective({ fov_degrees: Number(e.target.value) })
              }
              style={{ width: 60 }}
            />
          </label>
          <label>
            Near:{" "}
            <input
              type="number"
              value={
                (value.projection as { Perspective: PerspectiveFields })
                  .Perspective.near
              }
              onChange={(e) =>
                updatePerspective({ near: Number(e.target.value) })
              }
              style={{ width: 60 }}
            />
          </label>
          <label>
            Far:{" "}
            <input
              type="number"
              value={
                (value.projection as { Perspective: PerspectiveFields })
                  .Perspective.far
              }
              onChange={(e) =>
                updatePerspective({ far: Number(e.target.value) })
              }
              style={{ width: 60 }}
            />
          </label>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <label>
            Size:{" "}
            <input
              type="number"
              value={
                (value.projection as { Orthographic: OrthographicFields })
                  .Orthographic.size
              }
              onChange={(e) =>
                updateOrthographic({ size: Number(e.target.value) })
              }
              style={{ width: 60 }}
            />
          </label>
          <label>
            Near:{" "}
            <input
              type="number"
              value={
                (value.projection as { Orthographic: OrthographicFields })
                  .Orthographic.near
              }
              onChange={(e) =>
                updateOrthographic({ near: Number(e.target.value) })
              }
              style={{ width: 60 }}
            />
          </label>
          <label>
            Far:{" "}
            <input
              type="number"
              value={
                (value.projection as { Orthographic: OrthographicFields })
                  .Orthographic.far
              }
              onChange={(e) =>
                updateOrthographic({ far: Number(e.target.value) })
              }
              style={{ width: 60 }}
            />
          </label>
        </div>
      )}
      {error && <p style={{ color: "#e57373", margin: "4px 0 0" }}>{error}</p>}
    </div>
  );
}
