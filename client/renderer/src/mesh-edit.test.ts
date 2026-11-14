import { describe, expect, it } from "vitest";
import { meshVariantName } from "./mesh-edit";
import type { MeshShapeJson } from "./visual";

const BOX: MeshShapeJson = { Box: {} };
const SPHERE: MeshShapeJson = { Sphere: {} };
const CYLINDER: MeshShapeJson = { Cylinder: {} };
const PLANE: MeshShapeJson = { Plane: {} };
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
