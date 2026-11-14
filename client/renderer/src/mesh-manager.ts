import * as THREE from "three/webgpu";
import type { EventDispatcher } from "./events";
import {
  handlesToReconcile,
  parseMaterial,
  parseMesh,
  planVisualUpdate,
  type BuiltVisual,
  type MaterialJson,
  type MeshShapeJson,
  type Rgb,
} from "./visual";

/**
 * Draws entities from their `Mesh` and `Material` components (ADR-038).
 *
 * The manager is a view of the ECS: engine events only mark entities dirty,
 * and each dirty entity is reconciled against the engine's current
 * components, using the pure decisions in visual.ts. Position, rotation and
 * visibility are polled every frame, because they change without events.
 *
 * It runs inside the render loop, where a throw stops rendering (ADR-036),
 * so it never throws on component data: malformed JSON counts as no
 * component. The one deliberate throw is a missing default Material, which
 * means the renderer and the WASM package disagree.
 */

/** The slice of Engine the mesh manager reads. */
export interface MeshManagerEngine {
  readonly events: Pick<EventDispatcher, "subscribe">;
  getComponentJson(handle: number, kind: string): string | undefined;
  defaultComponentJson(kind: string): string | undefined;
  listEntityHierarchy(): string;
  getWorldMatrix(handle: number): ArrayLike<number> | undefined;
  getVisible(handle: number): boolean | undefined;
}

/**
 * The Three.js geometry for a `Mesh` shape, at Unity's primitive sizes
 * (ADR-039 decision 10): a cube of side 1, a sphere of diameter 1, a
 * cylinder of diameter 1 and height 2 along Y, and a 10 by 10 plane in the
 * local XZ plane facing +Y, whose material is single-sided. The entity's
 * world matrix scales them.
 */
export function buildGeometry(shape: MeshShapeJson): THREE.BufferGeometry {
  if ("Box" in shape) {
    return new THREE.BoxGeometry(1, 1, 1);
  }
  if ("Sphere" in shape) {
    return new THREE.SphereGeometry(
      0.5,
      SPHERE_WIDTH_SEGMENTS,
      SPHERE_HEIGHT_SEGMENTS,
    );
  }
  if ("Cylinder" in shape) {
    return new THREE.CylinderGeometry(0.5, 0.5, 2, CYLINDER_RADIAL_SEGMENTS);
  }
  const geometry = new THREE.PlaneGeometry(10, 10);
  // PlaneGeometry faces +Z; the component says +Y.
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// Tessellation is a renderer concern, not part of the component (ADR-038).
const SPHERE_WIDTH_SEGMENTS = 32;
const SPHERE_HEIGHT_SEGMENTS = 16;
const CYLINDER_RADIAL_SEGMENTS = 32;

/** sRGB, as authored. Three's setRGB assumes linear unless told otherwise. */
function setBaseColor(material: THREE.MeshStandardMaterial, color: Rgb): void {
  material.color.setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace);
}

interface Visual {
  mesh: THREE.Mesh;
  built: BuiltVisual;
}

export class MeshManager {
  private readonly engine: MeshManagerEngine;
  private readonly scene: THREE.Scene;
  private readonly visuals = new Map<number, Visual>();
  private readonly dirty = new Set<number>();
  private readonly moved = new Set<number>();
  private rescanAll = false;
  private fallback: MaterialJson | null = null;
  private readonly unsubscribe: () => void;

  constructor(engine: MeshManagerEngine, scene: THREE.Scene) {
    this.engine = engine;
    this.scene = scene;
    // Only records what to look at; it cannot throw inside a dispatch.
    this.unsubscribe = engine.events.subscribe((events) => {
      const affected = handlesToReconcile(events);
      if (affected === "all") {
        this.rescanAll = true;
        return;
      }
      for (const handle of affected) {
        this.dirty.add(handle);
      }
    });
  }

  /**
   * Reconciles every entity marked dirty since the last call, then copies
   * the world matrix and visibility from the engine onto each visual. Call
   * it every frame, after the engine tick that dispatches the events.
   */
  update(): void {
    this.reconcilePending();
    this.syncTransforms();
  }

  /** The visual's mesh for an entity, or null if it has none. */
  getMesh(handle: number): THREE.Mesh | null {
    return this.visuals.get(handle)?.mesh ?? null;
  }

  /**
   * The handle of the nearest visible visual hit by a ray through `ndc`, or
   * null. Editor-only in practice; callers gate it on edit mode.
   */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): number | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const candidates = [...this.visuals].filter(([, v]) => v.mesh.visible);
    const hits = raycaster.intersectObjects(
      candidates.map(([, v]) => v.mesh),
      false,
    );
    if (hits.length === 0) return null;
    return candidates.find(([, v]) => v.mesh === hits[0].object)?.[0] ?? null;
  }

  /**
   * Puts an entity's visual at a position now, and keeps the next update
   * from overwriting it with the engine's position. After a boundary respawn
   * the engine only reports the new position after its next tick, and the
   * visual must not draw one frame at the old spot.
   *
   * TODO(refactor): this, and the `moved` set, exist only because boundary
   * respawn runs in the client (respawn.ts). Once respawn is an engine
   * system, the engine's position is current after every tick and both go.
   * Trigger: moving boundary respawn into the engine.
   */
  moveTo(handle: number, x: number, y: number, z: number): void {
    const visual = this.visuals.get(handle);
    if (!visual) return;
    // Only the translation: rotation, scale and shear stay as drawn.
    visual.mesh.matrix.setPosition(x, y, z);
    visual.mesh.matrixWorldNeedsUpdate = true;
    this.moved.add(handle);
  }

  /** Removes and disposes every visual. */
  clear(): void {
    for (const handle of [...this.visuals.keys()]) {
      this.removeVisual(handle);
    }
  }

  /** Clears, and stops listening for engine events. */
  dispose(): void {
    this.unsubscribe();
    this.clear();
    this.dirty.clear();
    this.rescanAll = false;
  }

  private reconcilePending(): void {
    if (this.rescanAll) {
      for (const handle of this.allHandles()) {
        this.dirty.add(handle);
      }
      this.rescanAll = false;
    }
    if (this.dirty.size === 0) return;

    const fallback = this.fallbackMaterial();
    for (const handle of this.dirty) {
      this.reconcile(handle, fallback);
    }
    this.dirty.clear();
  }

  /** After a resync: every entity that exists and every visual we hold. */
  private allHandles(): number[] {
    const listed = JSON.parse(this.engine.listEntityHierarchy()) as {
      handle: number;
    }[];
    return [
      ...new Set([...this.visuals.keys(), ...listed.map((n) => n.handle)]),
    ];
  }

  /**
   * The engine's default Material, fetched once. Missing means the renderer
   * and the WASM package disagree about components, which is a bug to stop
   * on rather than paper over with a copy of the default here.
   */
  private fallbackMaterial(): MaterialJson {
    if (this.fallback === null) {
      const parsed = parseMaterial(
        this.engine.defaultComponentJson("Material"),
      );
      if (parsed === null) {
        throw new Error(
          "The engine offers no default Material, so the renderer and the " +
            "WASM package disagree about components; rebuild the WASM package.",
        );
      }
      this.fallback = parsed;
    }
    return this.fallback;
  }

  private reconcile(handle: number, fallback: MaterialJson): void {
    const mesh = parseMesh(this.engine.getComponentJson(handle, "Mesh"));
    const material =
      mesh === null
        ? null
        : parseMaterial(this.engine.getComponentJson(handle, "Material"));
    const visual = this.visuals.get(handle);
    const action = planVisualUpdate(
      mesh,
      material,
      fallback,
      visual?.built ?? null,
    );

    switch (action.kind) {
      case "none":
        return;
      case "dispose":
        this.removeVisual(handle);
        return;
      case "create": {
        const threeMaterial = new THREE.MeshStandardMaterial();
        setBaseColor(threeMaterial, action.baseColor);
        const threeMesh = new THREE.Mesh(
          buildGeometry(action.shape),
          threeMaterial,
        );
        // The engine's world matrix is the whole transform (ADR-039
        // decision 4): never recompose it from position/quaternion/scale.
        threeMesh.matrixAutoUpdate = false;
        this.scene.add(threeMesh);
        this.visuals.set(handle, {
          mesh: threeMesh,
          built: { shape: action.shape, baseColor: action.baseColor },
        });
        return;
      }
      case "update": {
        if (visual === undefined) return; // the plan only updates what exists
        if (action.shape !== undefined) {
          visual.mesh.geometry.dispose();
          visual.mesh.geometry = buildGeometry(action.shape);
        }
        if (action.baseColor !== undefined) {
          setBaseColor(
            visual.mesh.material as THREE.MeshStandardMaterial,
            action.baseColor,
          );
        }
        visual.built = {
          shape: action.shape ?? visual.built.shape,
          baseColor: action.baseColor ?? visual.built.baseColor,
        };
        return;
      }
    }
  }

  private removeVisual(handle: number): void {
    const visual = this.visuals.get(handle);
    if (!visual) return;
    this.scene.remove(visual.mesh);
    visual.mesh.geometry.dispose();
    (visual.mesh.material as THREE.Material).dispose();
    this.visuals.delete(handle);
  }

  /**
   * World matrices and visibility change without events, so poll. With
   * matrixAutoUpdate off, Three only refreshes matrixWorld when told to.
   */
  private syncTransforms(): void {
    for (const [handle, { mesh }] of this.visuals) {
      const matrix = this.engine.getWorldMatrix(handle);
      if (matrix && !this.moved.has(handle)) {
        mesh.matrix.fromArray(matrix);
        mesh.matrixWorldNeedsUpdate = true;
      }
      const visible = this.engine.getVisible(handle);
      if (visible !== undefined) {
        mesh.visible = visible;
      }
    }
    this.moved.clear();
  }
}
