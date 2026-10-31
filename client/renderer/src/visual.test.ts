import { describe, expect, it } from "vitest";
import type { ComponentKindName, EngineEvent } from "./events";
import {
  handlesToReconcile,
  hexToRgb,
  parseMaterial,
  parseMesh,
  planVisualUpdate,
  rgbFromInt,
  rgbToHex,
  type BuiltVisual,
  type MaterialJson,
  type MeshJson,
  type Rgb,
} from "./visual";

describe("parseMesh", () => {
  it.each([
    [
      "Box",
      '{"shape":{"Box":{"size":[1,2,3]}}}',
      { shape: { Box: { size: [1, 2, 3] } } },
    ],
    [
      "Sphere",
      '{"shape":{"Sphere":{"radius":0.5}}}',
      { shape: { Sphere: { radius: 0.5 } } },
    ],
    [
      "Cylinder",
      '{"shape":{"Cylinder":{"radius":0.5,"height":2}}}',
      { shape: { Cylinder: { radius: 0.5, height: 2 } } },
    ],
    [
      "Plane",
      '{"shape":{"Plane":{"size":[10,4]}}}',
      { shape: { Plane: { size: [10, 4] } } },
    ],
  ])("parses a %s", (_variant, json, expected) => {
    expect(parseMesh(json)).toEqual(expected);
  });

  it("returns null when the entity has no Mesh", () => {
    expect(parseMesh(undefined)).toBeNull();
  });

  it.each([
    ["text that is not JSON", "not json"],
    ["JSON null", "null"],
    ["an empty object", "{}"],
    ["an empty shape", '{"shape":{}}'],
    ["an unknown variant", '{"shape":{"Torus":{"radius":1}}}'],
    [
      "two variants at once",
      '{"shape":{"Sphere":{"radius":1},"Box":{"size":[1,1,1]}}}',
    ],
    ["a string where a number belongs", '{"shape":{"Sphere":{"radius":"2"}}}'],
    ["a box size with two components", '{"shape":{"Box":{"size":[1,1]}}}'],
    ["a non-numeric box component", '{"shape":{"Box":{"size":[1,1,"x"]}}}'],
  ])("returns null instead of throwing for %s", (_label, json) => {
    expect(parseMesh(json)).toBeNull();
  });
});

describe("parseMaterial", () => {
  it("parses a Material", () => {
    expect(parseMaterial('{"base_color":[0.25,0.5,0.75]}')).toEqual({
      base_color: [0.25, 0.5, 0.75],
    });
  });

  it("ignores fields it does not know, so the engine can add some", () => {
    expect(parseMaterial('{"base_color":[1,0,0],"roughness":0.5}')).toEqual({
      base_color: [1, 0, 0],
    });
  });

  it("returns null when the entity has no Material", () => {
    expect(parseMaterial(undefined)).toBeNull();
  });

  it.each([
    ["text that is not JSON", "not json"],
    ["an empty object", "{}"],
    ["a colour with two components", '{"base_color":[1,0]}'],
    ["a non-numeric component", '{"base_color":["a",0,0]}'],
  ])("returns null instead of throwing for %s", (_label, json) => {
    expect(parseMaterial(json)).toBeNull();
  });
});

describe("rgbToHex", () => {
  it.each([
    ["black", [0, 0, 0], "#000000"],
    ["white", [1, 1, 1], "#ffffff"],
    // The engine stores f32, so 79/255 and friends come back rounded.
    ["an f32 colour", [0.30980393, 0.61960787, 0.92941177], "#4f9eed"],
    ["out-of-range channels, clamped", [-0.2, 1.5, 0.5], "#00ff80"],
    ["non-finite channels, as zero", [NaN, Infinity, -Infinity], "#000000"],
  ] as [string, Rgb, string][])("converts %s", (_label, rgb, expected) => {
    expect(rgbToHex(rgb)).toBe(expected);
  });
});

describe("hexToRgb", () => {
  it.each([
    ["#000000", [0, 0, 0]],
    ["#ffffff", [1, 1, 1]],
    ["#4f9eed", [79 / 255, 158 / 255, 237 / 255]],
    ["#4F9EED", [79 / 255, 158 / 255, 237 / 255]],
  ] as [string, Rgb][])("parses %s", (hex, expected) => {
    expect(hexToRgb(hex)).toEqual(expected);
  });

  it.each([
    ["no leading #", "4f9eed"],
    ["the short form", "#fff"],
    ["a non-hex digit", "#gggggg"],
    ["an alpha channel", "#4f9eedff"],
    ["an empty string", ""],
  ])("returns null for %s", (_label, hex) => {
    expect(hexToRgb(hex)).toBeNull();
  });

  it("round-trips every one of the 256 levels, through f32 storage", () => {
    for (let level = 0; level < 256; level++) {
      const hex = `#${level.toString(16).padStart(2, "0").repeat(3)}`;
      const rgb = hexToRgb(hex);
      expect(rgb, hex).not.toBeNull();
      // The engine keeps Material colours as f32.
      const stored = rgb!.map((c) => Math.fround(c)) as Rgb;
      expect(rgbToHex(stored), hex).toBe(hex);
    }
  });
});

describe("rgbFromInt", () => {
  it.each([0x000000, 0xffffff, 0x4f9eed, 0xe74c3c])(
    "matches hexToRgb for %i",
    (value) => {
      const hex = `#${value.toString(16).padStart(6, "0")}`;
      expect(rgbFromInt(value)).toEqual(hexToRgb(hex));
    },
  );
});

const WHITE: MaterialJson = { base_color: [1, 1, 1] };
const RED: MaterialJson = { base_color: [1, 0, 0] };
const box = (x: number): MeshJson => ({ shape: { Box: { size: [x, 1, 1] } } });
const builtBox = (x: number, baseColor: Rgb): BuiltVisual => ({
  shape: { Box: { size: [x, 1, 1] } },
  baseColor,
});

describe("planVisualUpdate", () => {
  it("does nothing when there is no Mesh and nothing is built", () => {
    expect(planVisualUpdate(null, null, WHITE, null)).toStrictEqual({
      kind: "none",
    });
  });

  it("does nothing for a Material alone, which has no effect without a Mesh", () => {
    expect(planVisualUpdate(null, RED, WHITE, null)).toStrictEqual({
      kind: "none",
    });
  });

  it("disposes the visual when the Mesh is gone", () => {
    expect(
      planVisualUpdate(null, RED, WHITE, builtBox(1, [1, 0, 0])),
    ).toStrictEqual({ kind: "dispose" });
  });

  it("creates a visual with the fallback colour when there is no Material", () => {
    expect(planVisualUpdate(box(1), null, WHITE, null)).toStrictEqual({
      kind: "create",
      shape: box(1).shape,
      baseColor: [1, 1, 1],
    });
  });

  it("creates a visual with the Material's colour", () => {
    expect(planVisualUpdate(box(1), RED, WHITE, null)).toStrictEqual({
      kind: "create",
      shape: box(1).shape,
      baseColor: [1, 0, 0],
    });
  });

  it("does nothing when the visual already matches", () => {
    expect(
      planVisualUpdate(box(1), RED, WHITE, builtBox(1, [1, 0, 0])),
    ).toStrictEqual({ kind: "none" });
  });

  it("updates only the geometry when only the shape changed", () => {
    expect(
      planVisualUpdate(box(2), RED, WHITE, builtBox(1, [1, 0, 0])),
    ).toStrictEqual({ kind: "update", shape: box(2).shape });
  });

  it("updates only the colour when only the colour changed", () => {
    expect(
      planVisualUpdate(
        box(1),
        { base_color: [0, 1, 0] },
        WHITE,
        builtBox(1, [1, 0, 0]),
      ),
    ).toStrictEqual({ kind: "update", baseColor: [0, 1, 0] });
  });

  it("updates both when both changed", () => {
    expect(
      planVisualUpdate(
        box(3),
        { base_color: [0, 1, 0] },
        WHITE,
        builtBox(1, [1, 0, 0]),
      ),
    ).toStrictEqual({
      kind: "update",
      shape: box(3).shape,
      baseColor: [0, 1, 0],
    });
  });

  it("returns to the fallback colour when the Material is removed", () => {
    expect(
      planVisualUpdate(box(1), null, WHITE, builtBox(1, [1, 0, 0])),
    ).toStrictEqual({ kind: "update", baseColor: [1, 1, 1] });
  });

  it("updates the geometry when the variant changes", () => {
    const sphere: MeshJson = { shape: { Sphere: { radius: 0.5 } } };
    expect(
      planVisualUpdate(sphere, RED, WHITE, builtBox(1, [1, 0, 0])),
    ).toStrictEqual({ kind: "update", shape: sphere.shape });
  });

  it("treats shapes as equal whatever the property order", () => {
    const mesh: MeshJson = {
      shape: { Cylinder: { height: 2, radius: 0.5 } },
    };
    const built: BuiltVisual = {
      shape: { Cylinder: { radius: 0.5, height: 2 } },
      baseColor: [1, 0, 0],
    };
    expect(planVisualUpdate(mesh, RED, WHITE, built)).toStrictEqual({
      kind: "none",
    });
  });
});

const added = (handle: number, component: ComponentKindName): EngineEvent => ({
  kind: "componentAdded",
  handle,
  component,
});
const removed = (
  handle: number,
  component: ComponentKindName,
): EngineEvent => ({ kind: "componentRemoved", handle, component });
const changed = (
  handle: number,
  component: ComponentKindName,
): EngineEvent => ({ kind: "componentChanged", handle, component });

describe("handlesToReconcile", () => {
  it("is empty for an empty batch", () => {
    expect(handlesToReconcile([])).toEqual(new Set());
  });

  it.each([
    ["a Mesh add", added(4, "Mesh")],
    ["a Mesh remove", removed(4, "Mesh")],
    ["a Mesh change", changed(4, "Mesh")],
    ["a Material add", added(4, "Material")],
    ["a Material remove", removed(4, "Material")],
    ["a Material change", changed(4, "Material")],
  ])("includes the handle for %s", (_label, event) => {
    expect(handlesToReconcile([event])).toEqual(new Set([4]));
  });

  it("includes the handle of a despawn, so its visual is disposed", () => {
    expect(
      handlesToReconcile([{ kind: "entityDespawned", handle: 9 }]),
    ).toEqual(new Set([9]));
  });

  it.each(["LocalTransform", "Camera", "Velocity", "EntityInfo"] as const)(
    "ignores a %s change, which does not affect the visual",
    (component) => {
      expect(handlesToReconcile([changed(4, component)])).toEqual(new Set());
    },
  );

  it("ignores a spawn and a reparent", () => {
    expect(
      handlesToReconcile([
        { kind: "entitySpawned", handle: 1 },
        { kind: "entityReparented", handle: 1, oldParent: null, newParent: 2 },
      ]),
    ).toEqual(new Set());
  });

  it("means everything after a resync", () => {
    expect(handlesToReconcile([{ kind: "resync" }])).toBe("all");
  });

  it("means everything when a resync is anywhere in the batch", () => {
    expect(handlesToReconcile([added(1, "Mesh"), { kind: "resync" }])).toBe(
      "all",
    );
  });

  it("collects each affected handle once", () => {
    expect(
      handlesToReconcile([
        added(1, "Mesh"),
        changed(1, "Material"),
        changed(2, "Mesh"),
        { kind: "entityDespawned", handle: 1 },
      ]),
    ).toEqual(new Set([1, 2]));
  });
});
