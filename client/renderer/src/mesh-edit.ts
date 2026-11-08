import type { MeshShapeJson } from "./visual";

/**
 * Pure helpers behind the Inspector's Mesh editor (ADR-038): which numeric
 * parameters a shape has, and how to change one.
 *
 * The engine owns the variants' names and defaults (component-variants.ts);
 * what an editor row looks like is the client's concern, so it lives here.
 * A shape this module does not know (a future variant) has no fields, and
 * the editor shows a placeholder instead of failing.
 *
 * No Three.js or WASM dependency, so it is unit-tested on its own.
 */

/** One editable number of a shape, as an Inspector row. */
export interface ShapeField {
  /** Identifies the parameter within its variant, for `withShapeField`. */
  key: string;
  /** The row label. */
  label: string;
  value: number;
}

/** The variant's name, such as "Box", or "" for an empty shape. */
export function meshVariantName(shape: MeshShapeJson): string {
  return Object.keys(shape)[0] ?? "";
}

/** The shape's editable numbers, in display order. Empty for an unknown variant. */
export function shapeFields(shape: MeshShapeJson): ShapeField[] {
  if ("Box" in shape) {
    const [x, y, z] = shape.Box.size;
    return [
      { key: "x", label: "Size X", value: x },
      { key: "y", label: "Size Y", value: y },
      { key: "z", label: "Size Z", value: z },
    ];
  }
  if ("Sphere" in shape) {
    return [{ key: "radius", label: "Radius", value: shape.Sphere.radius }];
  }
  if ("Cylinder" in shape) {
    return [
      { key: "radius", label: "Radius", value: shape.Cylinder.radius },
      { key: "height", label: "Height", value: shape.Cylinder.height },
    ];
  }
  if ("Plane" in shape) {
    // The plane lies in XZ, so its second size is along Z.
    const [x, z] = shape.Plane.size;
    return [
      { key: "x", label: "Size X", value: x },
      { key: "z", label: "Size Z", value: z },
    ];
  }
  return [];
}

/**
 * A copy of `shape` with one parameter changed and the rest kept. An unknown
 * key or variant returns the shape unchanged. The input is never modified.
 */
export function withShapeField(
  shape: MeshShapeJson,
  key: string,
  value: number,
): MeshShapeJson {
  if ("Box" in shape) {
    const index = { x: 0, y: 1, z: 2 }[key];
    if (index === undefined) return shape;
    const size: [number, number, number] = [...shape.Box.size];
    size[index] = value;
    return { Box: { size } };
  }
  if ("Sphere" in shape) {
    return key === "radius" ? { Sphere: { radius: value } } : shape;
  }
  if ("Cylinder" in shape) {
    if (key === "radius") {
      return { Cylinder: { ...shape.Cylinder, radius: value } };
    }
    if (key === "height") {
      return { Cylinder: { ...shape.Cylinder, height: value } };
    }
    return shape;
  }
  if ("Plane" in shape) {
    const index = { x: 0, z: 1 }[key];
    if (index === undefined) return shape;
    const size: [number, number] = [...shape.Plane.size];
    size[index] = value;
    return { Plane: { size } };
  }
  return shape;
}
