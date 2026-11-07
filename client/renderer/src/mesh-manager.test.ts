import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { EventDispatcher, type EngineEvent } from "./events";
import {
  MeshManager,
  buildGeometry,
  type MeshManagerEngine,
} from "./mesh-manager";
import { rgbFromInt } from "./visual";

/** An engine with just enough state for the manager to read. */
class FakeEngine implements MeshManagerEngine {
  readonly events = new EventDispatcher();
  readonly entities = new Set<number>();
  readonly positions = new Map<number, [number, number, number]>();
  readonly rotations = new Map<number, [number, number, number, number]>();
  readonly visibility = new Map<number, boolean>();
  readonly componentQueries = vi.fn((_handle: number, _kind: string) => {});
  defaultMaterial: string | undefined = '{"base_color":[1,1,1]}';
  private readonly components = new Map<string, string>();

  setComponent(handle: number, kind: string, value: object): this {
    return this.setRaw(handle, kind, JSON.stringify(value));
  }

  setRaw(handle: number, kind: string, json: string): this {
    this.entities.add(handle);
    this.components.set(`${handle}:${kind}`, json);
    return this;
  }

  removeComponent(handle: number, kind: string): this {
    this.components.delete(`${handle}:${kind}`);
    return this;
  }

  despawn(handle: number): this {
    this.entities.delete(handle);
    for (const key of [...this.components.keys()]) {
      if (key.startsWith(`${handle}:`)) this.components.delete(key);
    }
    return this;
  }

  emit(...events: EngineEvent[]): void {
    this.events.dispatch(events);
  }

  getComponentJson(handle: number, kind: string): string | undefined {
    this.componentQueries(handle, kind);
    return this.components.get(`${handle}:${kind}`);
  }

  defaultComponentJson(kind: string): string | undefined {
    return kind === "Material" ? this.defaultMaterial : undefined;
  }

  listEntityHierarchy(): string {
    return JSON.stringify([...this.entities].map((handle) => ({ handle })));
  }

  getPosition(handle: number): ArrayLike<number> | undefined {
    return this.positions.get(handle);
  }

  getRotation(handle: number): ArrayLike<number> | undefined {
    return this.rotations.get(handle);
  }

  getVisible(handle: number): boolean | undefined {
    return this.visibility.get(handle);
  }
}

const added = (
  handle: number,
  component: "Mesh" | "Material",
): EngineEvent => ({
  kind: "componentAdded",
  handle,
  component,
});
const removed = (
  handle: number,
  component: "Mesh" | "Material",
): EngineEvent => ({ kind: "componentRemoved", handle, component });
const changed = (
  handle: number,
  component: "Mesh" | "Material",
): EngineEvent => ({ kind: "componentChanged", handle, component });

const BOX = { shape: { Box: { size: [2, 3, 4] } } };
const SPHERE = { shape: { Sphere: { radius: 0.5 } } };
const UNIT_BOX = { shape: { Box: { size: [1, 1, 1] } } };

/** A Material the way the engine reports it: sRGB floats, stored as f32. */
const material = (hex: number) => ({
  base_color: Array.from(rgbFromInt(hex), Math.fround),
});

function setup() {
  const engine = new FakeEngine();
  const scene = new THREE.Scene();
  const manager = new MeshManager(engine, scene);
  return { engine, scene, manager };
}

/** Adds a Mesh (and optionally a Material) and reconciles it. */
function spawnVisual(
  { engine, manager }: ReturnType<typeof setup>,
  handle: number,
  mesh: object,
  mat?: object,
): void {
  engine.setComponent(handle, "Mesh", mesh);
  const events = [added(handle, "Mesh")];
  if (mat) {
    engine.setComponent(handle, "Material", mat);
    events.push(added(handle, "Material"));
  }
  engine.emit(...events);
  manager.update();
  expect(manager.getMesh(handle), `visual for ${handle}`).not.toBeNull();
}

const standard = (mesh: THREE.Mesh) =>
  mesh.material as THREE.MeshStandardMaterial;

describe("buildGeometry", () => {
  it("builds a box with the given extents", () => {
    const geometry = buildGeometry({ Box: { size: [2, 3, 4] } });

    expect(geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect((geometry as THREE.BoxGeometry).parameters).toMatchObject({
      width: 2,
      height: 3,
      depth: 4,
    });
  });

  it("builds a sphere with the given radius", () => {
    const geometry = buildGeometry({ Sphere: { radius: 0.5 } });

    expect(geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect((geometry as THREE.SphereGeometry).parameters.radius).toBe(0.5);
  });

  it("builds a cylinder along Y with the given radius and height", () => {
    const geometry = buildGeometry({ Cylinder: { radius: 0.5, height: 2 } });

    expect(geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect((geometry as THREE.CylinderGeometry).parameters).toMatchObject({
      radiusTop: 0.5,
      radiusBottom: 0.5,
      height: 2,
    });
  });

  it("builds a plane in the XZ plane facing +Y", () => {
    const geometry = buildGeometry({ Plane: { size: [10, 4] } });

    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(10);
    expect(box.max.z - box.min.z).toBeCloseTo(4);
    expect(box.max.y - box.min.y).toBeCloseTo(0);
    const normal = geometry.attributes.normal as THREE.BufferAttribute;
    expect(normal.getY(0)).toBeCloseTo(1);
  });
});

describe("creating visuals", () => {
  it("draws nothing for an entity without a Mesh", () => {
    const { engine, scene, manager } = setup();
    engine.setComponent(1, "Material", material(0xff0000));

    engine.emit(added(1, "Material"));
    manager.update();

    expect(scene.children).toHaveLength(0);
  });

  it("adds a mesh to the scene when a Mesh is added", () => {
    const fixture = setup();

    spawnVisual(fixture, 1, BOX);

    expect(fixture.scene.children).toHaveLength(1);
    const mesh = fixture.manager.getMesh(1)!;
    expect(mesh).toBe(fixture.scene.children[0]);
    expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
  });

  it("uses the Material's colour, in sRGB", () => {
    const fixture = setup();

    spawnVisual(fixture, 1, BOX, material(0x4f9eed));

    expect(standard(fixture.manager.getMesh(1)!).color.getHexString()).toBe(
      "4f9eed",
    );
  });

  it.each([0x4f9eed, 0x48bb78, 0xf6ad55, 0xffffff])(
    "draws the colour %i exactly as the old renderer did",
    (hex) => {
      const fixture = setup();

      spawnVisual(fixture, 1, UNIT_BOX, material(hex));

      const drawn = standard(fixture.manager.getMesh(1)!).color;
      const before = new THREE.Color(hex);
      expect(drawn.getHex()).toBe(before.getHex());
      expect(drawn.r).toBeCloseTo(before.r, 6);
      expect(drawn.g).toBeCloseTo(before.g, 6);
      expect(drawn.b).toBeCloseTo(before.b, 6);
    },
  );

  it("uses the engine's default Material when there is none", () => {
    const fixture = setup();

    spawnVisual(fixture, 1, BOX);

    expect(standard(fixture.manager.getMesh(1)!).color.getHexString()).toBe(
      "ffffff",
    );
  });

  it("keeps a plane single-sided, so it is drawn and picked from +Y only", () => {
    const fixture = setup();

    spawnVisual(fixture, 1, { shape: { Plane: { size: [10, 10] } } });

    expect(standard(fixture.manager.getMesh(1)!).side).toBe(THREE.FrontSide);
  });

  it("keeps one visual per entity", () => {
    const fixture = setup();

    spawnVisual(fixture, 1, BOX);
    spawnVisual(fixture, 2, SPHERE);

    expect(fixture.scene.children).toHaveLength(2);
    expect(fixture.manager.getMesh(1)).not.toBe(fixture.manager.getMesh(2));
    expect(fixture.manager.getMesh(2)!.geometry).toBeInstanceOf(
      THREE.SphereGeometry,
    );
  });

  it("treats a malformed Mesh as no Mesh instead of throwing", () => {
    const { engine, scene, manager } = setup();
    engine.setRaw(1, "Mesh", "{}");

    engine.emit(added(1, "Mesh"));

    expect(() => manager.update()).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });

  it("throws loudly when the engine offers no default Material", () => {
    const { engine, manager } = setup();
    engine.defaultMaterial = undefined;
    engine.setComponent(1, "Mesh", BOX);

    engine.emit(added(1, "Mesh"));

    expect(() => manager.update()).toThrow("default Material");
  });
});

describe("changing visuals", () => {
  it("changes the colour in place, without rebuilding the geometry", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX, material(0xff0000));
    const mesh = fixture.manager.getMesh(1)!;
    const geometry = mesh.geometry;
    const dispose = vi.spyOn(geometry, "dispose");

    fixture.engine.setComponent(1, "Material", { base_color: [0, 1, 0] });
    fixture.engine.emit(changed(1, "Material"));
    fixture.manager.update();

    expect(fixture.manager.getMesh(1)).toBe(mesh);
    expect(mesh.geometry).toBe(geometry);
    expect(dispose).not.toHaveBeenCalled();
    expect(standard(mesh).color.getHexString()).toBe("00ff00");
  });

  it("rebuilds the geometry when the shape changes, and disposes the old one", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);
    const mesh = fixture.manager.getMesh(1)!;
    const oldGeometry = mesh.geometry;
    const dispose = vi.spyOn(oldGeometry, "dispose");

    fixture.engine.setComponent(1, "Mesh", SPHERE);
    fixture.engine.emit(changed(1, "Mesh"));
    fixture.manager.update();

    expect(fixture.manager.getMesh(1)).toBe(mesh);
    expect(mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("colours the visual when a Material is added after the Mesh", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);
    const mesh = fixture.manager.getMesh(1)!;

    fixture.engine.setComponent(1, "Material", material(0xff0000));
    fixture.engine.emit(added(1, "Material"));
    fixture.manager.update();

    expect(fixture.manager.getMesh(1)).toBe(mesh);
    expect(standard(mesh).color.getHexString()).toBe("ff0000");
  });

  it("returns to the default colour when the Material is removed", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX, material(0xff0000));

    fixture.engine.removeComponent(1, "Material");
    fixture.engine.emit(removed(1, "Material"));
    fixture.manager.update();

    expect(standard(fixture.manager.getMesh(1)!).color.getHexString()).toBe(
      "ffffff",
    );
  });

  it("removes and disposes the visual when the Mesh is removed", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX, material(0xff0000));
    const mesh = fixture.manager.getMesh(1)!;
    const disposeGeometry = vi.spyOn(mesh.geometry, "dispose");
    const disposeMaterial = vi.spyOn(standard(mesh), "dispose");

    fixture.engine.removeComponent(1, "Mesh");
    fixture.engine.emit(removed(1, "Mesh"));
    fixture.manager.update();

    expect(fixture.scene.children).toHaveLength(0);
    expect(fixture.manager.getMesh(1)).toBeNull();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
  });

  it("removes the visual when its entity is despawned", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);

    fixture.engine.despawn(1);
    fixture.engine.emit({ kind: "entityDespawned", handle: 1 });
    fixture.manager.update();

    expect(fixture.scene.children).toHaveLength(0);
  });

  it("ignores events that do not concern a visual", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);
    const mesh = fixture.manager.getMesh(1)!;
    fixture.engine.componentQueries.mockClear();

    fixture.engine.emit(
      { kind: "componentChanged", handle: 1, component: "LocalTransform" },
      { kind: "entitySpawned", handle: 2 },
    );
    fixture.manager.update();

    expect(fixture.manager.getMesh(1)).toBe(mesh);
    expect(fixture.engine.componentQueries).not.toHaveBeenCalled();
  });

  it("reconciles an entity once however many events it had this frame", () => {
    const fixture = setup();
    fixture.engine.setComponent(1, "Mesh", BOX);
    fixture.engine.setComponent(1, "Material", material(0xff0000));

    fixture.engine.emit(added(1, "Mesh"));
    fixture.engine.emit(added(1, "Material"));
    fixture.engine.emit(changed(1, "Mesh"));
    fixture.manager.update();

    const meshQueries = fixture.engine.componentQueries.mock.calls.filter(
      ([, kind]) => kind === "Mesh",
    );
    expect(meshQueries).toHaveLength(1);
  });

  it("asks the engine nothing on a frame with nothing to reconcile", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);
    fixture.engine.componentQueries.mockClear();

    fixture.manager.update();

    expect(fixture.engine.componentQueries).not.toHaveBeenCalled();
  });
});

describe("resync", () => {
  it("rebuilds from the engine's current state", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);
    spawnVisual(fixture, 3, SPHERE);
    const kept = fixture.manager.getMesh(1)!;

    // While events were lost: entity 3 went away and entity 2 arrived.
    fixture.engine.despawn(3);
    fixture.engine.setComponent(2, "Mesh", UNIT_BOX);
    fixture.engine.emit({ kind: "resync" });
    fixture.manager.update();

    expect(fixture.manager.getMesh(1)).toBe(kept);
    expect(fixture.manager.getMesh(2)).not.toBeNull();
    expect(fixture.manager.getMesh(3)).toBeNull();
    expect(fixture.scene.children).toHaveLength(2);
  });
});

describe("following the engine", () => {
  it("copies position and rotation each update", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);
    fixture.engine.positions.set(1, [1, 2, 3]);
    fixture.engine.rotations.set(1, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);

    fixture.manager.update();

    const mesh = fixture.manager.getMesh(1)!;
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh.quaternion.z).toBeCloseTo(Math.SQRT1_2);
    expect(mesh.quaternion.w).toBeCloseTo(Math.SQRT1_2);
  });

  it("follows the engine's visibility", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);

    fixture.engine.visibility.set(1, false);
    fixture.manager.update();
    expect(fixture.manager.getMesh(1)!.visible).toBe(false);

    fixture.engine.visibility.set(1, true);
    fixture.manager.update();
    expect(fixture.manager.getMesh(1)!.visible).toBe(true);
  });

  it("puts a visual at a position now, and the next update does not undo it", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);
    fixture.engine.positions.set(1, [9, 1, 0]); // the engine's stale position

    fixture.manager.moveTo(1, -5, 1, 0);
    fixture.manager.update();
    expect(fixture.manager.getMesh(1)!.position.toArray()).toEqual([-5, 1, 0]);

    fixture.engine.positions.set(1, [-4.5, 1, 0]);
    fixture.manager.update();
    expect(fixture.manager.getMesh(1)!.position.toArray()).toEqual([
      -4.5, 1, 0,
    ]);
  });

  it("ignores a move for an entity with no visual", () => {
    const fixture = setup();

    expect(() => fixture.manager.moveTo(42, 1, 2, 3)).not.toThrow();
    expect(fixture.scene.children).toHaveLength(0);
  });
});

describe("pick", () => {
  /** A camera at z = 10 looking down -Z, and two unit cubes in front of it. */
  function pickFixture() {
    const fixture = setup();
    spawnVisual(fixture, 1, UNIT_BOX);
    spawnVisual(fixture, 2, UNIT_BOX);
    fixture.engine.positions.set(1, [0, 0, 0]);
    fixture.engine.positions.set(2, [0, 0, -3]);
    fixture.manager.update();
    fixture.scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    return { ...fixture, camera };
  }

  it("returns the nearest visible visual under the ray", () => {
    const { manager, camera } = pickFixture();

    expect(manager.pick(new THREE.Vector2(0, 0), camera)).toBe(1);
  });

  it("skips a visual that is not visible", () => {
    const { engine, manager, camera } = pickFixture();
    engine.visibility.set(1, false);
    manager.update();

    expect(manager.pick(new THREE.Vector2(0, 0), camera)).toBe(2);
  });

  it("returns null when the ray hits nothing", () => {
    const { manager, camera } = pickFixture();

    expect(manager.pick(new THREE.Vector2(0.9, 0.9), camera)).toBeNull();
  });
});

describe("lifetime", () => {
  it("clear removes and disposes every visual", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);
    spawnVisual(fixture, 2, SPHERE);
    const dispose = vi.spyOn(fixture.manager.getMesh(1)!.geometry, "dispose");

    fixture.manager.clear();

    expect(fixture.scene.children).toHaveLength(0);
    expect(fixture.manager.getMesh(1)).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("dispose clears, and stops listening for events", () => {
    const fixture = setup();
    spawnVisual(fixture, 1, BOX);

    fixture.manager.dispose();
    fixture.engine.setComponent(2, "Mesh", BOX);
    fixture.engine.emit(added(2, "Mesh"));
    fixture.manager.update();

    expect(fixture.scene.children).toHaveLength(0);
  });
});
