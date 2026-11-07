import { describe, expect, it, vi } from "vitest";
import {
  componentVariants,
  parseComponentVariants,
  switchVariant,
  type ComponentVariantsEngine,
} from "./component-variants";
import { ReflectionError } from "./reflection-error";

const HANDLE = 7;

const BOX = { name: "Box", default: { shape: { Box: { size: [1, 1, 1] } } } };
const SPHERE = {
  name: "Sphere",
  default: { shape: { Sphere: { radius: 0.5 } } },
};

/** The engine's variant listing, as the wasm export returns it. */
function listing(...variants: object[]): string {
  return JSON.stringify(variants);
}

/** An engine that lists Box and Sphere and accepts every write. */
function engineWith(overrides: Partial<ComponentVariantsEngine> = {}) {
  return {
    componentVariantsJson: vi.fn((_kind: string): string | undefined =>
      listing(BOX, SPHERE),
    ),
    setComponentJson: vi.fn(
      (_handle: number, _kind: string, _json: string): void => {},
    ),
    ...overrides,
  };
}

describe("parseComponentVariants", () => {
  it("reads each name with its default as ready-to-send JSON", () => {
    expect(parseComponentVariants(listing(BOX, SPHERE))).toEqual([
      { name: "Box", defaultJson: JSON.stringify(BOX.default) },
      { name: "Sphere", defaultJson: JSON.stringify(SPHERE.default) },
    ]);
  });

  it("keeps the engine's order", () => {
    const names = parseComponentVariants(listing(SPHERE, BOX)).map(
      (variant) => variant.name,
    );

    expect(names).toEqual(["Sphere", "Box"]);
  });

  it("accepts an empty list", () => {
    expect(parseComponentVariants("[]")).toEqual([]);
  });

  it("produces JSON that reads back as the engine's default", () => {
    const [box] = parseComponentVariants(listing(BOX));

    expect(JSON.parse(box.defaultJson)).toEqual(BOX.default);
  });

  it.each([
    ["an object", "{}"],
    ["null", "null"],
    ["an entry that is not an object", "[1]"],
    ["an entry with no name", '[{"default":{}}]'],
    ["a name that is not a string", '[{"name":3,"default":{}}]'],
    ["an entry with no default", '[{"name":"Box"}]'],
    ["a default that is not an object", '[{"name":"Box","default":3}]'],
    ["a default that is null", '[{"name":"Box","default":null}]'],
    ["a default that is an array", '[{"name":"Box","default":[]}]'],
  ])("rejects %s loudly", (_label, json) => {
    expect(() => parseComponentVariants(json)).toThrow(
      "Malformed component variant list",
    );
  });
});

describe("componentVariants", () => {
  it("asks the engine for the kind and parses the answer", () => {
    const engine = engineWith();

    const variants = componentVariants(engine, "Mesh");

    expect(engine.componentVariantsJson).toHaveBeenCalledWith("Mesh");
    expect(variants.map((variant) => variant.name)).toEqual(["Box", "Sphere"]);
  });

  it("is empty when the engine lists no variants for the kind", () => {
    const engine = engineWith({
      componentVariantsJson: vi.fn(() => undefined),
    });

    expect(componentVariants(engine, "Velocity")).toEqual([]);
  });

  it("surfaces a malformed listing instead of hiding it", () => {
    const engine = engineWith({ componentVariantsJson: vi.fn(() => "{}") });

    expect(() => componentVariants(engine, "Mesh")).toThrow(
      "Malformed component variant list",
    );
  });
});

describe("switchVariant", () => {
  it("writes the named variant's default over the component", () => {
    const engine = engineWith();

    const result = switchVariant(engine, HANDLE, "Mesh", "Sphere");

    expect(result).toBeNull();
    expect(engine.setComponentJson).toHaveBeenCalledWith(
      HANDLE,
      "Mesh",
      JSON.stringify(SPHERE.default),
    );
  });

  it("reports an unknown variant without writing", () => {
    const engine = engineWith();

    const result = switchVariant(engine, HANDLE, "Mesh", "Torus");

    expect(result).toBe("Mesh has no variant Torus");
    expect(engine.setComponentJson).not.toHaveBeenCalled();
  });

  it("reports a kind without variants the same way", () => {
    const engine = engineWith({
      componentVariantsJson: vi.fn(() => undefined),
    });

    const result = switchVariant(engine, HANDLE, "Velocity", "Box");

    expect(result).toBe("Velocity has no variant Box");
    expect(engine.setComponentJson).not.toHaveBeenCalled();
  });

  it("returns the engine's reason when it rejects the write", () => {
    const engine = engineWith({
      setComponentJson: vi.fn(() => {
        throw new ReflectionError("radius must be greater than zero");
      }),
    });

    expect(switchVariant(engine, HANDLE, "Mesh", "Sphere")).toBe(
      "radius must be greater than zero",
    );
  });

  it("rethrows anything that is not a ReflectionError", () => {
    const engine = engineWith({
      setComponentJson: vi.fn(() => {
        throw new Error("boom");
      }),
    });

    expect(() => switchVariant(engine, HANDLE, "Mesh", "Sphere")).toThrow(
      "boom",
    );
  });
});
