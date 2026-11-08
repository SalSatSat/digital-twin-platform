import { describe, expect, it } from "vitest";
import { meshVariantName, shapeFields, withShapeField } from "./mesh-edit";
import type { MeshShapeJson } from "./visual";

const BOX: MeshShapeJson = { Box: { size: [2, 3, 4] } };
const SPHERE: MeshShapeJson = { Sphere: { radius: 0.5 } };
const CYLINDER: MeshShapeJson = { Cylinder: { radius: 0.5, height: 2 } };
const PLANE: MeshShapeJson = { Plane: { size: [10, 4] } };
/** A variant added later, which this editor does not know. */
const MODEL = { Model: { key: "chair" } } as unknown as MeshShapeJson;

describe("meshVariantName", () => {
  it.each([
    ["Box", BOX],
    ["Sphere", SPHERE],
    ["Cylinder", CYLINDER],
    ["Plane", PLANE],
  ])("names a %s", (name, shape) => {
    expect(meshVariantName(shape)).toBe(name);
  });

  it("names a variant it does not know", () => {
    expect(meshVariantName(MODEL)).toBe("Model");
  });
});

describe("shapeFields", () => {
  it("lists a box's three sizes", () => {
    expect(shapeFields(BOX)).toEqual([
      { key: "x", label: "Size X", value: 2 },
      { key: "y", label: "Size Y", value: 3 },
      { key: "z", label: "Size Z", value: 4 },
    ]);
  });

  it("lists a sphere's radius", () => {
    expect(shapeFields(SPHERE)).toEqual([
      { key: "radius", label: "Radius", value: 0.5 },
    ]);
  });

  it("lists a cylinder's radius and height", () => {
    expect(shapeFields(CYLINDER)).toEqual([
      { key: "radius", label: "Radius", value: 0.5 },
      { key: "height", label: "Height", value: 2 },
    ]);
  });

  it("lists a plane's X and Z sizes, as the plane lies in XZ", () => {
    expect(shapeFields(PLANE)).toEqual([
      { key: "x", label: "Size X", value: 10 },
      { key: "z", label: "Size Z", value: 4 },
    ]);
  });

  it("has no fields for a variant it does not know", () => {
    expect(shapeFields(MODEL)).toEqual([]);
  });
});

describe("withShapeField", () => {
  it.each([
    ["x", { Box: { size: [9, 3, 4] } }],
    ["y", { Box: { size: [2, 9, 4] } }],
    ["z", { Box: { size: [2, 3, 9] } }],
  ])("sets a box's %s and keeps the others", (key, expected) => {
    expect(withShapeField(BOX, key, 9)).toEqual(expected);
  });

  it("sets a sphere's radius", () => {
    expect(withShapeField(SPHERE, "radius", 9)).toEqual({
      Sphere: { radius: 9 },
    });
  });

  it("sets a cylinder's radius and keeps its height", () => {
    expect(withShapeField(CYLINDER, "radius", 9)).toEqual({
      Cylinder: { radius: 9, height: 2 },
    });
  });

  it("sets a cylinder's height and keeps its radius", () => {
    expect(withShapeField(CYLINDER, "height", 9)).toEqual({
      Cylinder: { radius: 0.5, height: 9 },
    });
  });

  it("sets a plane's X and keeps its Z", () => {
    expect(withShapeField(PLANE, "x", 9)).toEqual({ Plane: { size: [9, 4] } });
  });

  it("sets a plane's Z and keeps its X", () => {
    expect(withShapeField(PLANE, "z", 9)).toEqual({ Plane: { size: [10, 9] } });
  });

  it("returns the shape unchanged for a key it does not have", () => {
    expect(withShapeField(BOX, "w", 9)).toEqual(BOX);
    expect(withShapeField(SPHERE, "height", 9)).toEqual(SPHERE);
  });

  it("returns a variant it does not know unchanged", () => {
    expect(withShapeField(MODEL, "x", 9)).toEqual(MODEL);
  });

  it("leaves its input alone and returns a different shape", () => {
    const input: MeshShapeJson = { Box: { size: [2, 3, 4] } };

    const result = withShapeField(input, "x", 9);

    expect(input).toEqual({ Box: { size: [2, 3, 4] } });
    expect(result).not.toEqual(input);
  });

  it("changes exactly the field it was asked to, for every field of every shape", () => {
    let checked = 0;
    for (const shape of [BOX, SPHERE, CYLINDER, PLANE]) {
      for (const field of shapeFields(shape)) {
        checked++;
        const after = shapeFields(withShapeField(shape, field.key, 7));
        const expected = shapeFields(shape).map((f) =>
          f.key === field.key ? { ...f, value: 7 } : f,
        );
        expect(after, `${meshVariantName(shape)} ${field.key}`).toEqual(
          expected,
        );
      }
    }
    // Box 3, Sphere 1, Cylinder 2, Plane 2: an empty loop must not pass.
    expect(checked).toBe(8);
  });
});
