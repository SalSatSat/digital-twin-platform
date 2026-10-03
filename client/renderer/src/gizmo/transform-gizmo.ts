import * as THREE from "three/webgpu";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Engine, EntityHierarchyNode } from "../engine";

/** How often the entity hierarchy is re-read to find ancestors (ms). */
const HIERARCHY_REFRESH_MS = 500;

type Vec3Tuple = [number, number, number];
type QuatTuple = [number, number, number, number];

/** One entity's world pose at the moment a drag started. */
interface DragTarget {
  handle: number;
  position: Vec3Tuple;
  rotation: QuatTuple;
}

interface DragStart {
  pivot: THREE.Vector3;
  targets: DragTarget[];
}

/**
 * Editor-context transform gizmo: a thin adapter around Three.js's
 * TransformControls (ADR-034, including its amendment). The ECS stays
 * authoritative. The controls move an invisible proxy placed at the
 * average world position of the selected entities; each drag applies
 * the proxy's movement to every selected entity through
 * Engine.setWorldTransform, and the engine converts the requested world
 * pose into each entity's LocalTransform under its own parent.
 *
 * An entity whose ancestor is also selected is not moved directly, so
 * it follows its ancestor instead of moving twice. Hidden entities are
 * ignored (not counted in the pivot, not moved).
 *
 * Current scope: translate only. Rotate mode is a later step.
 */
export class TransformGizmo {
  private controls: TransformControls;
  private proxy = new THREE.Object3D();
  private scene: THREE.Scene;
  private canvas: HTMLElement;
  private engine: Engine;
  private getMesh: (handle: number) => THREE.Object3D | null;

  private attached = false;
  private handles: readonly number[] = [];
  // handle -> parent handle (null for roots), from the last hierarchy read.
  private parentOf = new Map<number, number | null>();
  private lastHierarchyRefreshMs = 0;
  private dragStart: DragStart | null = null;
  private onTransformCommitted: ((handles: readonly number[]) => void) | null =
    null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    canvas: HTMLElement,
    engine: Engine,
    getMesh: (handle: number) => THREE.Object3D | null,
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.engine = engine;
    this.getMesh = getMesh;

    // Capture phase, so these run before TransformControls' own
    // pointerdown/pointerup listeners on the same element.
    canvas.addEventListener("pointerdown", this.onPointerDownCapture, true);
    canvas.addEventListener("pointerup", this.onPointerEndCapture, true);
    canvas.addEventListener("pointercancel", this.onPointerEndCapture, true);

    scene.add(this.proxy);
    this.controls = new TransformControls(camera, canvas);
    this.controls.mode = "translate";
    this.controls.addEventListener("mouseDown", this.onMouseDown);
    this.controls.addEventListener("objectChange", this.onObjectChange);
    this.controls.addEventListener("mouseUp", this.onMouseUp);
    scene.add(this.controls.getHelper());
  }

  /** Called when a drag finishes, with the entities it moved. */
  setOnTransformCommitted(fn: (handles: readonly number[]) => void): void {
    this.onTransformCommitted = fn;
  }

  /**
   * True while the pointer is over a gizmo handle. Renderer uses this
   * to avoid arming a viewport pick for a press that starts a drag.
   */
  isHandleHovered(): boolean {
    return this.controls.axis !== null;
  }

  /**
   * Call once per frame, after the scene has been synced from the ECS
   * and before rendering. `handles` is the selection; pass the same
   * array instance until the selection changes (a new instance triggers
   * a hierarchy re-read). An empty list detaches the gizmo.
   */
  update(camera: THREE.Camera, handles: readonly number[]): void {
    this.controls.camera = camera;
    if (this.controls.dragging) return; // never re-target mid-drag

    const now = performance.now();
    if (
      handles !== this.handles ||
      now - this.lastHierarchyRefreshMs > HIERARCHY_REFRESH_MS
    ) {
      this.refreshHierarchy();
      this.lastHierarchyRefreshMs = now;
    }
    this.handles = handles;

    const pivot = this.averageWorldPosition(this.resolveTargets());
    if (pivot === null) {
      this.detach();
      return;
    }
    this.proxy.position.copy(pivot);
    if (!this.attached) {
      this.controls.attach(this.proxy);
      this.attached = true;
    }
  }

  dispose(): void {
    this.canvas.removeEventListener(
      "pointerdown",
      this.onPointerDownCapture,
      true,
    );
    this.canvas.removeEventListener(
      "pointerup",
      this.onPointerEndCapture,
      true,
    );
    this.canvas.removeEventListener(
      "pointercancel",
      this.onPointerEndCapture,
      true,
    );
    this.scene.remove(this.controls.getHelper());
    this.scene.remove(this.proxy);
    this.controls.dispose();
  }

  private detach(): void {
    if (!this.attached) return;
    this.controls.detach();
    this.attached = false;
  }

  private refreshHierarchy(): void {
    const nodes = JSON.parse(
      this.engine.listEntityHierarchy(),
    ) as EntityHierarchyNode[];
    this.parentOf = new Map(nodes.map((n) => [n.handle, n.parent_handle]));
  }

  /**
   * The selected entities the gizmo moves: alive, visible, and with no
   * selected (eligible) ancestor.
   */
  private resolveTargets(): number[] {
    const eligible = this.handles.filter(
      (h) => this.parentOf.has(h) && this.getMesh(h)?.visible === true,
    );
    const eligibleSet = new Set(eligible);
    return eligible.filter((h) => !this.hasAncestorIn(h, eligibleSet));
  }

  private hasAncestorIn(handle: number, set: ReadonlySet<number>): boolean {
    let parent = this.parentOf.get(handle) ?? null;
    while (parent !== null) {
      if (set.has(parent)) return true;
      parent = this.parentOf.get(parent) ?? null;
    }
    return false;
  }

  private averageWorldPosition(
    handles: readonly number[],
  ): THREE.Vector3 | null {
    const sum = new THREE.Vector3();
    let count = 0;
    for (const handle of handles) {
      const p = this.engine.getPosition(handle);
      if (p === undefined) continue;
      sum.x += p[0];
      sum.y += p[1];
      sum.z += p[2];
      count++;
    }
    return count === 0 ? null : sum.multiplyScalar(1 / count);
  }

  // Alt+left belongs to the camera (orbit). TransformControls ignores
  // Alt, so disable it for the duration of an Alt-press.
  private onPointerDownCapture = (event: PointerEvent): void => {
    this.controls.enabled = !event.altKey;
  };

  private onPointerEndCapture = (): void => {
    this.controls.enabled = true;
  };

  private onMouseDown = (): void => {
    const targets: DragTarget[] = [];
    for (const handle of this.resolveTargets()) {
      const p = this.engine.getPosition(handle);
      const r = this.engine.getRotation(handle);
      if (p === undefined || r === undefined) continue;
      targets.push({
        handle,
        position: [p[0], p[1], p[2]],
        rotation: [r[0], r[1], r[2], r[3]],
      });
    }
    this.dragStart = { pivot: this.proxy.position.clone(), targets };
  };

  private onObjectChange = (): void => {
    const start = this.dragStart;
    if (start === null) return;
    const dx = this.proxy.position.x - start.pivot.x;
    const dy = this.proxy.position.y - start.pivot.y;
    const dz = this.proxy.position.z - start.pivot.z;
    for (const t of start.targets) {
      try {
        this.engine.setWorldTransform(
          t.handle,
          [t.position[0] + dx, t.position[1] + dy, t.position[2] + dz],
          t.rotation,
        );
      } catch (e) {
        console.warn("Transform gizmo write rejected:", e);
      }
    }
  };

  private onMouseUp = (): void => {
    const start = this.dragStart;
    this.dragStart = null;
    if (start !== null && start.targets.length > 0) {
      this.onTransformCommitted?.(start.targets.map((t) => t.handle));
    }
  };
}
