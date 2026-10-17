import { describe, expect, it, vi } from "vitest";
import {
  addDefaultComponent,
  addableKinds,
  parseComponentKinds,
  removeOptionalComponent,
  type ComponentEditEngine,
  type ComponentKindInfo,
} from "./component-edit";
import { ReflectionError } from "./reflection-error";

const HANDLE = 7;

const velocity: ComponentKindInfo = {
  kind: "Velocity",
  displayName: "Velocity",
  optional: true,
};
const mesh: ComponentKindInfo = {
  kind: "Mesh",
  displayName: "Mesh",
  optional: true,
};
const camera: ComponentKindInfo = {
  kind: "Camera",
  displayName: "Camera",
  optional: false,
};

/** An engine that accepts everything, with any method replaceable. */
function engineWith(overrides: Partial<ComponentEditEngine> = {}) {
  return {
    defaultComponentJson: vi.fn(
      (_kind: string): string | undefined => '{"value":[0,0,0]}',
    ),
    addComponentJson: vi.fn(
      (_handle: number, _kind: string, _json: string): void => {},
    ),
    removeComponent: vi.fn((_handle: number, _kind: string): void => {}),
    ...overrides,
  };
}

function rejectingWith(error: Error) {
  return vi.fn(() => {
    throw error;
  });
}

describe("parseComponentKinds", () => {
  it("reads kind, display name and the optional flag", () => {
    const json = JSON.stringify([
      { kind: "Velocity", display_name: "Velocity", optional: true },
    ]);

    expect(parseComponentKinds(json)).toEqual([velocity]);
  });

  it("keeps the registry order", () => {
    const json = JSON.stringify([
      { kind: "LocalTransform", display_name: "Transform", optional: false },
      { kind: "Camera", display_name: "Camera", optional: false },
      { kind: "Velocity", display_name: "Velocity", optional: true },
    ]);

    expect(parseComponentKinds(json).map((k) => k.kind)).toEqual([
      "LocalTransform",
      "Camera",
      "Velocity",
    ]);
  });

  it.each([
    ["an object", "{}"],
    ["null", "null"],
    ["a string", '"Velocity"'],
  ])("throws when the payload is %s rather than an array", (_label, json) => {
    expect(() => parseComponentKinds(json)).toThrow(/component kind/i);
  });

  it.each([
    ["has no optional flag", { kind: "Velocity", display_name: "Velocity" }],
    [
      "has a non-boolean optional flag",
      { kind: "Velocity", display_name: "Velocity", optional: "yes" },
    ],
    ["has no kind", { display_name: "Velocity", optional: true }],
    ["has no display name", { kind: "Velocity", optional: true }],
  ])("throws when an entry %s", (_label, entry) => {
    expect(() => parseComponentKinds(JSON.stringify([entry]))).toThrow(
      /component kind/i,
    );
  });
});

describe("addableKinds", () => {
  it("offers an optional kind the entity lacks", () => {
    expect(addableKinds([velocity], [])).toEqual([velocity]);
  });

  it("omits an optional kind the entity already has", () => {
    const offered = addableKinds([velocity, mesh], ["Velocity"]);

    expect(offered.map((k) => k.kind)).toEqual(["Mesh"]);
  });

  it("never offers a mandatory kind, even when the entity lacks it", () => {
    const offered = addableKinds([camera, mesh], []);

    expect(offered.map((k) => k.kind)).toEqual(["Mesh"]);
  });

  it("keeps the registry order", () => {
    const offered = addableKinds([velocity, mesh], []);

    expect(offered.map((k) => k.kind)).toEqual(["Velocity", "Mesh"]);
  });

  it("offers nothing when the entity has every optional kind", () => {
    expect(addableKinds([camera, velocity], ["Camera", "Velocity"])).toEqual(
      [],
    );
  });
});

describe("addDefaultComponent", () => {
  it("adds the engine's default for the kind and reports success", () => {
    const engine = engineWith();

    const message = addDefaultComponent(engine, HANDLE, "Velocity");

    expect(message).toBeNull();
    expect(engine.defaultComponentJson).toHaveBeenCalledWith("Velocity");
    expect(engine.addComponentJson).toHaveBeenCalledWith(
      HANDLE,
      "Velocity",
      '{"value":[0,0,0]}',
    );
  });

  it("adds nothing and says so when the engine has no default for the kind", () => {
    const engine = engineWith({
      defaultComponentJson: vi.fn(
        (_kind: string): string | undefined => undefined,
      ),
    });

    const message = addDefaultComponent(engine, HANDLE, "Camera");

    expect(message).toBe("Camera cannot be added");
    expect(engine.addComponentJson).not.toHaveBeenCalled();
  });

  it("returns the engine's reason when it rejects the add", () => {
    const engine = engineWith({
      addComponentJson: rejectingWith(
        new ReflectionError("component already present on entity"),
      ),
    });

    expect(addDefaultComponent(engine, HANDLE, "Velocity")).toBe(
      "component already present on entity",
    );
  });

  it("rethrows anything that is not a ReflectionError", () => {
    const failure = new TypeError("wasm binding is stale");
    const engine = engineWith({ addComponentJson: rejectingWith(failure) });

    expect(() => addDefaultComponent(engine, HANDLE, "Velocity")).toThrow(
      failure,
    );
  });
});

describe("removeOptionalComponent", () => {
  it("removes the component and reports success", () => {
    const engine = engineWith();

    const message = removeOptionalComponent(engine, HANDLE, "Velocity");

    expect(message).toBeNull();
    expect(engine.removeComponent).toHaveBeenCalledWith(HANDLE, "Velocity");
  });

  it("returns the engine's reason when it rejects the removal", () => {
    const engine = engineWith({
      removeComponent: rejectingWith(
        new ReflectionError("component not present on entity"),
      ),
    });

    expect(removeOptionalComponent(engine, HANDLE, "Velocity")).toBe(
      "component not present on entity",
    );
  });

  it("rethrows anything that is not a ReflectionError", () => {
    const failure = new TypeError("wasm binding is stale");
    const engine = engineWith({ removeComponent: rejectingWith(failure) });

    expect(() => removeOptionalComponent(engine, HANDLE, "Velocity")).toThrow(
      failure,
    );
  });
});
