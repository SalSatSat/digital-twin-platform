import * as THREE from "three/webgpu";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Engine, EntityHierarchyNode } from "../engine";

/** How often the attached entity's root-ness is re-checked (ms). */
const ROOT_RECHECK_MS = 500;

interface LocalTransformJson {
  position: [number, number, number];
  rotation_euler_deg: [number, number, number];
}

/**
 * Editor-context transform gizmo: a thin adapter around Three.js's
 * TransformControls (ADR-034). The ECS stays authoritative — the
 * controls move the entity's mesh, and this class converts that into
 * a LocalTransform write via Engine.setComponentJson. SceneManager
 * then re-syncs the mesh from the ECS on the next frame.
 *
 * Current scope (Phase 18, step 2): translate only, root entities
 * only. Child entities need a world-to-local conversion (step 3);
 * rotate mode is step 4.
 */
export class TransformGizmo {
  private controls: TransformControls;
  private scene: THREE.Scene;
  private canvas: HTMLElement;
  private engine: Engine;

  private target: THREE.Object3D | null = null;
  private attachedHandle: number | null = null;
  private checkedHandle: number | null = null;
  private isRoot = false;
  private lastRootCheckMs = 0;
  // Rotation captured at drag start, so repeated writes during a drag
  // don't round-trip the rotation through Euler angles each time.
  private dragRotation: [number, number, number] | null = null;
  private onTransformCommitted: ((handle: number) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    canvas: HTMLElement,
    engine: Engine,
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.engine = engine;

    // Capture phase, so these run before TransformControls' own
    // pointerdown/pointerup listeners on the same element.
    canvas.addEventListener("pointerdown", this.onPointerDownCapture, true);
    canvas.addEventListener("pointerup", this.onPointerEndCapture, true);
    canvas.addEventListener("pointercancel", this.onPointerEndCapture, true);

    this.controls = new TransformControls(camera, canvas);
    this.controls.mode = "translate";
    this.controls.addEventListener("mouseDown", this.onMouseDown);
    this.controls.addEventListener("objectChange", this.onObjectChange);
    this.controls.addEventListener("mouseUp", this.onMouseUp);
    scene.add(this.controls.getHelper());
  }

  /** Called when a drag finishes, with the entity that was dragged. */
  setOnTransformCommitted(fn: (handle: number) => void): void {
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
   * and before rendering. Pass null for handle/mesh to detach.
   */
  update(
    camera: THREE.Camera,
    handle: number | null,
    mesh: THREE.Object3D | null,
  ): void {
    this.controls.camera = camera;
    if (this.controls.dragging) return; // never re-target mid-drag

    if (handle === null || mesh === null || !mesh.visible) {
      this.detach();
      this.checkedHandle = null;
      return;
    }

    const now = performance.now();
    if (
      handle !== this.checkedHandle ||
      now - this.lastRootCheckMs > ROOT_RECHECK_MS
    ) {
      this.checkedHandle = handle;
      this.isRoot = this.isRootEntity(handle);
      this.lastRootCheckMs = now;
    }
    if (!this.isRoot) {
      this.detach();
      return;
    }

    if (this.target !== mesh) {
      this.controls.attach(mesh);
      this.target = mesh;
    }
    this.attachedHandle = handle;
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
    this.controls.dispose();
  }

  private detach(): void {
    if (this.target === null) return;
    this.controls.detach();
    this.target = null;
    this.attachedHandle = null;
  }

  private isRootEntity(handle: number): boolean {
    const nodes = JSON.parse(
      this.engine.listEntityHierarchy(),
    ) as EntityHierarchyNode[];
    const node = nodes.find((n) => n.handle === handle);
    return node !== undefined && node.parent_handle === null;
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
    const handle = this.attachedHandle;
    if (handle === null) return;
    const json = this.engine.getComponentJson(handle, "LocalTransform");
    this.dragRotation = json
      ? (JSON.parse(json) as LocalTransformJson).rotation_euler_deg
      : null;
  };

  private onObjectChange = (): void => {
    const handle = this.attachedHandle;
    const mesh = this.target;
    if (handle === null || mesh === null || this.dragRotation === null) return;
    const p = mesh.position;
    const value: LocalTransformJson = {
      position: [p.x, p.y, p.z],
      rotation_euler_deg: this.dragRotation,
    };
    try {
      this.engine.setComponentJson(
        handle,
        "LocalTransform",
        JSON.stringify(value),
      );
    } catch (e) {
      console.warn("Transform gizmo write rejected:", e);
    }
  };

  private onMouseUp = (): void => {
    const handle = this.attachedHandle;
    this.dragRotation = null;
    if (handle !== null) this.onTransformCommitted?.(handle);
  };
}
