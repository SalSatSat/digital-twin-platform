import * as THREE from "three/webgpu";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Engine, EntityHierarchyNode } from "../engine";
import { ParentMap } from "./parent-map";
import { resolveGizmoTargets } from "./targets";
import { orientationSource, scaledLocal, type Vec3Tuple } from "./scale-drag";

type QuatTuple = [number, number, number, number];

/**
 * One entity at the moment a drag started: its world pose, for translate and
 * rotate, and its local scale, for scale.
 */
interface DragTarget {
  handle: number;
  position: Vec3Tuple;
  rotation: QuatTuple;
  scale: Vec3Tuple;
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
 * ignored (not counted in the pivot, not moved). Whether an entity is
 * targetable comes from the engine (see targets.ts), not from anything
 * drawn, so an entity without a Mesh, such as a camera, gets the gizmo too.
 *
 * Modes: translate, rotate and scale. Rotation is about the selection's
 * pivot, so a multi-selection turns as a rigid group. Scale is different on
 * purpose (ADR-039 decision 9): each entity scales about its own origin, so
 * no position changes, and each entity's own local axes get the drag's
 * per-axis factor. TransformControls scales in local space only, so in
 * scale mode the proxy takes the world rotation of the primary selection
 * (or the first target, see scale-drag.ts), and the handles line up with
 * that entity's axes. Scale is written as local scale through
 * Engine.setLocalScale, never as a world pose.
 */
export class TransformGizmo {
  private controls: TransformControls;
  private proxy = new THREE.Object3D();
  private scene: THREE.Scene;
  private canvas: HTMLElement;
  private engine: Engine;

  private attached = false;
  private handles: readonly number[] = [];
  private primary: number | null = null;
  // Who exists and who is whose parent. Re-read only when the engine's change
  // events say the hierarchy changed (ADR-036); no polling.
  private parents: ParentMap;
  private unsubscribeEvents: () => void;
  private dragStart: DragStart | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    canvas: HTMLElement,
    engine: Engine,
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.engine = engine;
    this.parents = new ParentMap(
      () => JSON.parse(engine.listEntityHierarchy()) as EntityHierarchyNode[],
    );
    this.unsubscribeEvents = engine.events.subscribe((batch) =>
      this.parents.observe(batch),
    );

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

  /**
   * True while the pointer is over a gizmo handle. Renderer uses this
   * to avoid arming a viewport pick for a press that starts a drag.
   */
  isHandleHovered(): boolean {
    return this.controls.axis !== null;
  }

  /** Switches between translate, rotate and scale. Ignored mid-drag. */
  setMode(mode: "translate" | "rotate" | "scale"): void {
    if (this.controls.dragging) return;
    this.controls.mode = mode;
  }

  /**
   * Call once per frame, after the scene has been synced from the ECS
   * and before rendering. `handles` is the selection and `primary` its
   * primary entity (ADR-033). An empty list detaches the gizmo.
   */
  update(
    camera: THREE.Camera,
    handles: readonly number[],
    primary: number | null,
  ): void {
    this.controls.camera = camera;
    if (this.controls.dragging) return; // never re-target mid-drag

    this.parents.refreshIfDirty();
    this.handles = handles;
    this.primary = primary;

    const targets = this.resolveTargets();
    const pivot = this.averageWorldPosition(targets);
    if (pivot === null) {
      this.detach();
      return;
    }
    this.proxy.position.copy(pivot);
    // Every drag starts from scale 1, so during a scale drag the proxy's
    // scale is the drag's per-axis factor.
    this.proxy.scale.set(1, 1, 1);
    this.orientProxy(targets);
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
    this.unsubscribeEvents();
  }

  /**
   * Translate and rotate keep the handles world-aligned, and every rotation
   * drag starts from identity, so the proxy's quaternion is the drag's
   * rotation delta. Scale handles follow one entity's axes instead.
   */
  private orientProxy(targets: readonly number[]): void {
    this.proxy.quaternion.identity();
    if (this.controls.mode !== "scale") return;
    const source = orientationSource(this.primary, targets);
    const r = source === null ? undefined : this.engine.getRotation(source);
    if (r !== undefined) this.proxy.quaternion.set(r[0], r[1], r[2], r[3]);
  }

  private detach(): void {
    if (!this.attached) return;
    this.controls.detach();
    this.attached = false;
  }

  /**
   * The selected entities the gizmo moves: alive, visible according to the
   * engine, and with no selected (eligible) ancestor.
   */
  private resolveTargets(): number[] {
    return resolveGizmoTargets(this.handles, this.parents, (handle) =>
      this.engine.getVisible(handle),
    );
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
      const s = this.engine.getLocalScale(handle);
      if (p === undefined || r === undefined || s === undefined) continue;
      targets.push({
        handle,
        position: [p[0], p[1], p[2]],
        rotation: [r[0], r[1], r[2], r[3]],
        scale: [s[0], s[1], s[2]],
      });
    }
    this.dragStart = { pivot: this.proxy.position.clone(), targets };
  };

  private onObjectChange = (): void => {
    const start = this.dragStart;
    if (start === null) return;
    if (this.controls.mode === "scale") {
      this.applyScaleDrag(start);
      return;
    }
    const rotating = this.controls.mode === "rotate";
    const delta = this.proxy.quaternion;
    const dx = this.proxy.position.x - start.pivot.x;
    const dy = this.proxy.position.y - start.pivot.y;
    const dz = this.proxy.position.z - start.pivot.z;
    for (const t of start.targets) {
      let position: Vec3Tuple;
      let rotation: QuatTuple = t.rotation;
      if (rotating) {
        // Orbit the pivot and compose the same world-space rotation delta,
        // both from drag-start values so repeated writes never accumulate.
        const orbit = new THREE.Vector3(
          t.position[0] - start.pivot.x,
          t.position[1] - start.pivot.y,
          t.position[2] - start.pivot.z,
        )
          .applyQuaternion(delta)
          .add(start.pivot);
        const turned = new THREE.Quaternion(...t.rotation).premultiply(delta);
        position = [orbit.x, orbit.y, orbit.z];
        rotation = [turned.x, turned.y, turned.z, turned.w];
      } else {
        position = [t.position[0] + dx, t.position[1] + dy, t.position[2] + dz];
      }
      try {
        this.engine.setWorldTransform(t.handle, position, rotation);
      } catch (e) {
        console.warn("Transform gizmo write rejected:", e);
      }
    }
  };

  /** Scales each target about its own origin; positions never change. */
  private applyScaleDrag(start: DragStart): void {
    const factor: Vec3Tuple = [
      this.proxy.scale.x,
      this.proxy.scale.y,
      this.proxy.scale.z,
    ];
    for (const t of start.targets) {
      const scale = scaledLocal(t.scale, factor);
      if (scale === null) continue; // a zero or non-finite axis: skip the frame
      try {
        this.engine.setLocalScale(t.handle, scale);
      } catch (e) {
        console.warn("Transform gizmo scale write rejected:", e);
      }
    }
  }

  private onMouseUp = (): void => {
    this.dragStart = null;
  };
}
