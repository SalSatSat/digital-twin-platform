// Drives SceneManager headlessly against a fake engine: the wiring between a
// scene definition, the engine's components and the mesh manager (ADR-038).
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { EventDispatcher } from "./events";
import { DEFAULT_SCENE } from "./scene";
import { SceneManager } from "./scene-manager";
import type { Engine } from "./engine";

class FakeEngine {
  events = new EventDispatcher();
  next = 1;
  names = new Map<number, string>();
  cameras = new Set<number>();
  dynamic = new Set<number>();
  components = new Map<string, string>();
  positions = new Map<number, [number, number, number]>();
  pending = new Map<number, [number, number, number]>();
  added: { handle: number; kind: string; json: string }[] = [];
  scaled: { handle: number; scale: readonly number[] }[] = [];
  spawnCamera(name: string, x: number, y: number, z: number) {
    const h = this.next++;
    this.cameras.add(h);
    this.names.set(h, name);
    this.positions.set(h, [x, y, z]);
    return h;
  }
  setActiveCamera() {}
  getCameraTransform(h: number) {
    const p = this.positions.get(h)!;
    return new Float32Array([p[0], p[1], p[2], 0, 0, 0, 1]);
  }
  spawnDynamicObject(name: string, x: number, y: number, z: number) {
    const h = this.next++;
    this.dynamic.add(h);
    this.names.set(h, name);
    this.positions.set(h, [x, y, z]);
    return h;
  }
  spawnStaticObject(name: string, x: number, y: number, z: number) {
    const h = this.next++;
    this.names.set(h, name);
    this.positions.set(h, [x, y, z]);
    return h;
  }
  addComponentJson(handle: number, kind: string, json: string) {
    this.added.push({ handle, kind, json });
    this.components.set(`${handle}:${kind}`, json);
  }
  getComponentJson(h: number, kind: string) {
    if (kind === "Camera" && this.cameras.has(h))
      return '{"projection":{"Perspective":{"fov_degrees":75,"near":0.1,"far":1000}}}';
    if (kind === "Velocity" && this.dynamic.has(h)) return '{"value":[1,0,0]}';
    return this.components.get(`${h}:${kind}`);
  }
  defaultComponentJson(kind: string) {
    return kind === "Material" ? '{"base_color":[1,1,1]}' : undefined;
  }
  listEntityHierarchy() {
    return JSON.stringify([...this.names.keys()].map((handle) => ({ handle })));
  }
  getPosition(h: number) {
    const p = this.positions.get(h);
    return p ? new Float32Array(p) : undefined;
  }
  getRotation(h: number) {
    return this.positions.has(h) ? new Float32Array([0, 0, 0, 1]) : undefined;
  }
  getWorldMatrix(h: number) {
    const p = this.positions.get(h);
    return p
      ? new Float32Array(new THREE.Matrix4().makeTranslation(...p).toArray())
      : undefined;
  }
  setLocalScale(handle: number, scale: readonly [number, number, number]) {
    this.scaled.push({ handle, scale: [...scale] });
  }
  getVisible(h: number) {
    return this.positions.has(h) ? true : undefined;
  }
  setWorldTransform(h: number, pos: readonly [number, number, number]) {
    this.pending.set(h, [pos[0], pos[1], pos[2]]);
  }
  setComponentJson() {}
  despawnEntity(h: number) {
    this.positions.delete(h);
    this.names.delete(h);
    return true;
  }
  /** What the engine does at the end of a tick: apply writes, dispatch events. */
  tick() {
    for (const [h, p] of this.pending) this.positions.set(h, p);
    this.pending.clear();
    const events = this.added.splice(0).map((a) => ({
      kind: "componentAdded" as const,
      handle: a.handle,
      component: a.kind as "Mesh" | "Material",
    }));
    if (events.length > 0) this.events.dispatch(events);
  }
}

function setup() {
  const engine = new FakeEngine();
  const scene = new THREE.Scene();
  const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
  const sm = new SceneManager(engine as unknown as Engine, scene, canvas);
  return { engine, scene, sm };
}
const meshes = (scene: THREE.Scene) =>
  scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);

/** Where Three draws a mesh: its world matrix's translation. */
function drawnPosition(scene: THREE.Scene, mesh: THREE.Mesh): number[] {
  scene.updateMatrixWorld();
  return new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).toArray();
}

describe("SceneManager and components", () => {
  it("adds Mesh then Material for each demo cube, as wire JSON", () => {
    const { engine, sm } = setup();
    sm.loadScene(DEFAULT_SCENE);
    const kinds = engine.added.map((a) => a.kind);
    expect(kinds).toEqual(Array(4).fill(["Mesh", "Material"]).flat());
    const first = engine.added[0];
    expect(JSON.parse(first.json)).toEqual({ shape: { Box: {} } });
    const mat = JSON.parse(engine.added[1].json);
    expect(mat.base_color.map((c: number) => Math.round(c * 255))).toEqual([
      0x4f, 0x9e, 0xed,
    ]);
  });

  it("keeps the demo cubes at 0.8 by scaling each one, as the old Box size did", () => {
    const { engine, sm } = setup();
    sm.loadScene(DEFAULT_SCENE);

    const cubes = [...engine.names]
      .filter(([, name]) => name.startsWith("Cube "))
      .map(([handle]) => handle);
    expect(cubes).toHaveLength(4);
    expect(engine.scaled).toEqual(
      cubes.map((handle) => ({ handle, scale: [0.8, 0.8, 0.8] })),
    );
  });

  it("draws the four cubes with the old colours after one tick and update", () => {
    const { engine, scene, sm } = setup();
    sm.loadScene(DEFAULT_SCENE);
    expect(meshes(scene)).toHaveLength(0); // nothing until events arrive
    engine.tick();
    sm.update(0.016, 100, -5, false);
    const drawn = meshes(scene);
    expect(drawn).toHaveLength(4);
    const hexes = drawn.map((m) =>
      (m.material as THREE.MeshStandardMaterial).color.getHex(),
    );
    expect(hexes.sort()).toEqual(
      [0x4f9eed, 0x48bb78, 0xf6ad55, 0xffffff].sort(),
    );
    for (const m of drawn) {
      // A unit Box: the 0.8 now comes from each cube's scale (next test).
      expect((m.geometry as THREE.BoxGeometry).parameters.width).toBe(1);
    }
  });

  it("follows the engine position, and a respawn moves the cube now without being pulled back", () => {
    const { engine, scene, sm } = setup();
    sm.loadScene(DEFAULT_SCENE);
    engine.tick();
    sm.update(0.016, 100, -5, true);
    const cubeA = [...engine.names].find(([, n]) => n === "Cube A")![0];
    const meshA = meshes(scene).find(
      (m) =>
        (m.material as THREE.MeshStandardMaterial).color.getHex() === 0x4f9eed,
    )!;
    expect(drawnPosition(scene, meshA)).toEqual([-3, 1.5, 0]);

    engine.positions.set(cubeA, [4, 1.5, 0]); // past the boundary at x = 3
    sm.update(0.016, 3, -5, true);
    expect(drawnPosition(scene, meshA)).toEqual([-5, 1.5, 0]); // moved now
    expect(engine.pending.get(cubeA)).toEqual([-5, 1.5, 0]); // engine told

    engine.tick(); // the engine reports the respawn position
    sm.update(0.016, 3, -5, true);
    expect(drawnPosition(scene, meshA)).toEqual([-5, 1.5, 0]);
    expect(scene.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(
      4,
    );
  });

  it("picks through the manager", () => {
    const { engine, scene, sm } = setup();
    sm.loadScene(DEFAULT_SCENE);
    engine.tick();
    sm.update(0.016, 100, -5, false);
    scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(-3, 0, 10);
    camera.lookAt(-3, 0, 0);
    camera.updateMatrixWorld(true);
    const handle = sm.pickEntity(new THREE.Vector2(0, 0), camera);
    expect(engine.names.get(handle!)).toBe("Cube B"); // y = 0
  });

  it("unloadScene removes every visual at once, and dispose stops listening", () => {
    const { engine, scene, sm } = setup();
    sm.loadScene(DEFAULT_SCENE);
    engine.tick();
    sm.update(0.016, 100, -5, false);
    expect(meshes(scene)).toHaveLength(4);
    sm.unloadScene();
    expect(meshes(scene)).toHaveLength(0);
    sm.dispose();
    engine.components.set("99:Mesh", '{"shape":{"Sphere":{}}}');
    engine.events.dispatch([
      { kind: "componentAdded", handle: 99, component: "Mesh" },
    ]);
    sm.update(0.016, 100, -5, false);
    expect(meshes(scene)).toHaveLength(0);
  });

  it("applies a definition's scale through setLocalScale after the spawn, and only when given", () => {
    const { engine, sm } = setup();
    sm.loadScene({
      name: "Scaled",
      cameras: [],
      lights: [],
      dynamicEntities: [
        {
          name: "Mover",
          position: { x: 0, y: 0, z: 0 },
          scale: { x: -1, y: 2, z: 0.5 },
          velocity: { x: 1, y: 0, z: 0 },
        },
      ],
      staticEntities: [
        {
          name: "Big",
          position: { x: 1, y: 0, z: 0 },
          scale: { x: 2, y: 3, z: 4 },
        },
        { name: "Plain", position: { x: 2, y: 0, z: 0 } },
      ],
    });

    const handleOf = (name: string) =>
      [...engine.names].find(([, n]) => n === name)![0];
    expect(engine.scaled).toEqual([
      { handle: handleOf("Mover"), scale: [-1, 2, 0.5] },
      { handle: handleOf("Big"), scale: [2, 3, 4] },
    ]);
  });
});
