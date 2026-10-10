import * as THREE from "three/webgpu";
import { Engine } from "./engine";
import { SceneManager } from "./scene-manager";
import { DEFAULT_SCENE } from "./scene";
import type { SceneDefinition } from "./scene";
import type { RenderBackend } from "./backends/backend";
import { WebGLBackend } from "./backends/webgl";
import { WebGPUBackend } from "./backends/webgpu";
import { createGridMesh, updateGridPosition } from "./grid/grid-mesh";
import { ViewGizmo } from "./gizmo/view-gizmo";
import { TransformGizmo } from "./gizmo/transform-gizmo";
import { isEditableTarget } from "./input/is-editable-target";

// Stable empty list for the gizmo outside edit mode: the gizmo re-reads the
// entity hierarchy whenever it sees a new array instance, so a fresh []
// each frame would re-read it every frame.
const NO_GIZMO_TARGETS: readonly number[] = [];

const BOUNDARY_X = 4.0;
const SPAWN_X = -3.0;
const PICK_DRAG_THRESHOLD_PX = 4;

type SceneCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/**
 * Owns the Three.js scene graph, render backend, and render loop.
 * Delegates all scene content management to SceneManager.
 *
 * The Renderer is responsible for:
 * - The render backend (WebGPU or WebGL)
 * - The render loop (requestAnimationFrame)
 * - Window resize and keyboard handling
 * - Selecting and using the active camera each frame
 * - The Editor-context reference grid (a rendering aid)
 *   not ECS scene content, so it lives here rather than SceneManager
 * - The Editor-context view gizmo (also a rendering aid, same reasoning)
 *
 * The Renderer is NOT responsible for:
 * - What entities exist in the scene
 * - What cameras exist in the scene
 * - What lights exist in the scene
 * Those responsibilities belong to SceneManager.
 */
export class Renderer {
  private threeScene: THREE.Scene;
  private backend: RenderBackend;
  private sceneManager: SceneManager;
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private gridMesh: THREE.Mesh;
  private gizmo: ViewGizmo;
  private transformGizmo: TransformGizmo;
  // ECS handles the transform gizmo acts on (edit mode only), fed from
  // the editor's whole selection via setGizmoTargets.
  private gizmoTargetHandles: readonly number[] = [];

  // Fallback camera used before a scene is loaded
  private fallbackCamera: THREE.PerspectiveCamera;

  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;

  // Whether the simulation is paused for editing. When true, the ECS
  // tick receives a delta_time of 0 (holding physics/movement still),
  // while the scene sync (mesh transforms, camera controls) continues
  // to receive real delta_time so camera navigation stays responsive.
  // Also controls the Editor-context reference grid's visibility.
  private editMode: boolean = false;

  private onEntityPicked:
    | ((handle: number | null, opts: { additive: boolean }) => void)
    | null = null;
  private isPickCandidate = false;
  private pickDownX = 0;
  private pickDownY = 0;

  private resizeObserver: ResizeObserver;

  constructor(
    canvas: HTMLCanvasElement,
    gizmoCanvas: HTMLCanvasElement,
    gizmoLabel: HTMLElement,
    engine: Engine,
  ) {
    this.canvas = canvas;
    this.engine = engine;
    this.threeScene = new THREE.Scene();
    this.threeScene.background = new THREE.Color(0x1a1a1a);

    this.fallbackCamera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000,
    );
    this.fallbackCamera.position.z = 10;

    this.sceneManager = new SceneManager(engine, this.threeScene, canvas);

    const hasWebGPU = !!navigator.gpu;
    this.backend = hasWebGPU
      ? new WebGPUBackend(canvas)
      : new WebGLBackend(canvas);

    console.log(`Render backend: ${hasWebGPU ? "WebGPU" : "WebGL (fallback)"}`);

    this.backend.setPixelRatio(window.devicePixelRatio);
    this.backend.setSize(canvas.clientWidth, canvas.clientHeight);

    // Grid material variant must match the chosen backend — GLSL
    // ShaderMaterial only runs on WebGLRenderer, TSL/NodeMaterial only
    // on WebGPURenderer. Hidden by default; shown only in edit mode.
    this.gridMesh = createGridMesh(hasWebGPU);
    this.gridMesh.visible = this.editMode;
    this.threeScene.add(this.gridMesh);

    // The gizmo always renders with its own THREE.WebGPURenderer (which falls back to WebGL2 itself),
    // independent of hasWebGPU — see ViewGizmo's doc comment for why.
    // Its canvas's own visibility (shown only in edit mode) is owned
    // by EngineView.tsx via the editMode prop, not here — same split
    // as the main canvas itself.
    this.gizmo = new ViewGizmo(gizmoCanvas, gizmoLabel);
    this.gizmo.setOnPresetSelected((preset) => {
      this.sceneManager.snapToPreset(preset);
    });
    this.gizmo.setOnToggleProjection(() => {
      this.sceneManager.toggleEditorCameraProjection();
    });

    // Editor-context transform gizmo (ADR-034). Lives in the main
    // scene; stays detached unless an entity is targeted in edit mode.
    this.transformGizmo = new TransformGizmo(
      this.threeScene,
      this.fallbackCamera,
      canvas,
      engine,
      (handle) => this.sceneManager.getEntityMesh(handle),
    );

    // ResizeObserver, not window "resize" — the canvas's own size can
    // change from layout shifts (e.g. side panels appearing/disappearing
    // when toggling edit mode) without the browser window itself
    // resizing. window.resize would miss that entirely.
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(canvas);
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("mousedown", this.onPickMouseDown);
    this.canvas.addEventListener("mouseup", this.onPickMouseUp);
  }

  /**
   * Initializes the render backend and the view gizmo's own renderer.
   * Must be awaited before calling setup().
   */
  async initialize(): Promise<void> {
    await Promise.all([this.backend.initialize(), this.gizmo.initialize()]);
  }

  /**
   * Sets up the scene and attaches input controls.
   * Engine must already be initialized before calling this.
   */
  setup(scene: SceneDefinition = DEFAULT_SCENE): void {
    this.sceneManager.loadScene(scene);
    this.sceneManager.attachControls();
  }

  /**
   * Returns the SceneManager for external access.
   * Used by EngineView to switch cameras or load new scenes.
   */
  getSceneManager(): SceneManager {
    return this.sceneManager;
  }

  /**
   * Begins the render loop.
   */
  start(): void {
    this.lastFrameTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  }

  /**
   * Stops the render loop. Safe to call multiple times.
   */
  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Cleans up all resources.
   * Does not dispose the Engine — the caller owns that lifecycle.
   */
  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    this.canvas.removeEventListener("mousedown", this.onPickMouseDown);
    this.canvas.removeEventListener("mouseup", this.onPickMouseUp);
    this.sceneManager.unloadScene();
    this.gridMesh.geometry.dispose();
    if (this.gridMesh.material instanceof THREE.Material) {
      this.gridMesh.material.dispose();
    }
    this.transformGizmo.dispose();
    this.gizmo.dispose();
    this.backend.dispose();
  }

  /**
   * Sets whether the simulation is paused for editing.
   *
   * While true, the ECS tick (MovementSystem, HierarchySystem) receives
   * a delta_time of 0 each frame, so Inspector edits to position aren't
   * immediately overwritten by simulation. Scene sync and camera
   * controls are unaffected — they keep receiving real delta_time so
   * camera fly-through navigation stays usable while paused. Also
   * toggles the reference grid's visibility.
   */
  setEditMode(enabled: boolean): void {
    this.editMode = enabled;
    this.gridMesh.visible = enabled;
  }

  /**
   * Sets the callback fired when a viewport click selects (or
   * deselects) an entity. Only fires in edit mode; only fires for
   * plain left-click, not drags — see onPickMouseUp below.
   */
  setOnEntityPicked(
    fn: (handle: number | null, opts: { additive: boolean }) => void,
  ): void {
    this.onEntityPicked = fn;
  }

  /**
   * Sets the entities the transform gizmo acts on (the editor's
   * selection). Only takes effect in edit mode.
   */
  setGizmoTargets(handles: readonly number[]): void {
    this.gizmoTargetHandles = handles;
  }

  private onPickMouseDown = (event: MouseEvent): void => {
    // A press on a gizmo handle starts a gizmo drag, not a pick. The
    // gizmo's hovered axis is updated on pointerdown, which fires
    // before this mousedown.
    if (
      event.button !== 0 ||
      event.altKey ||
      this.transformGizmo.isHandleHovered()
    ) {
      this.isPickCandidate = false;
      return;
    }
    this.isPickCandidate = true;
    this.pickDownX = event.clientX;
    this.pickDownY = event.clientY;
  };

  private onPickMouseUp = (event: MouseEvent): void => {
    const wasCandidate = this.isPickCandidate;
    this.isPickCandidate = false;
    if (!wasCandidate || event.button !== 0 || !this.editMode) return;

    const dx = event.clientX - this.pickDownX;
    const dy = event.clientY - this.pickDownY;
    if (dx * dx + dy * dy > PICK_DRAG_THRESHOLD_PX * PICK_DRAG_THRESHOLD_PX) {
      return; // was a drag, not a click
    }

    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const handle = this.sceneManager.pickEntity(ndc, this.getActiveCamera());
    this.onEntityPicked?.(handle, {
      additive: event.ctrlKey || event.metaKey,
    });
  };

  private onResize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    // Guard against transient 0×0 during layout — ResizeObserver can
    // fire mid-transition before the box has settled.
    if (width === 0 || height === 0) return;

    this.fallbackCamera.aspect = width / height;
    this.fallbackCamera.updateProjectionMatrix();

    this.sceneManager.onResize();
    this.backend.setSize(width, height);
    this.gizmo.resize();
  };

  /**
   * W / E switch the transform gizmo to translate / rotate (Unity's
   * keys). Returns true if the key was consumed. Bare keys only, so
   * browser shortcuts like Ctrl+W are never intercepted, and not while
   * the right mouse button is held, when WASD flies the camera.
   */
  private handleGizmoModeKey(event: KeyboardEvent): boolean {
    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return false;
    }
    if (this.sceneManager.isEditorCameraFlying()) return false;
    switch (event.key.toLowerCase()) {
      case "w":
        this.transformGizmo.setMode("translate");
        return true;
      case "e":
        this.transformGizmo.setMode("rotate");
        return true;
      default:
        return false;
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    // Letter shortcuts must not fire while typing in an Inspector field
    // (the entity name, or the "e" a number input accepts).
    if (isEditableTarget(event.target)) return;

    if (this.editMode && this.handleGizmoModeKey(event)) return;

    if (event.key === "f" || event.key === "F") {
      if (!document.fullscreenElement) {
        this.canvas.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    }
  };

  private getActiveCamera(): SceneCamera {
    const context = this.editMode ? "Editor" : "Runtime";
    return this.sceneManager.getActiveCamera(context) ?? this.fallbackCamera;
  }

  private renderLoop = (currentTime: number): void => {
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    // In edit mode, hold the simulation still (delta_time = 0) so
    // Inspector edits aren't immediately overwritten by MovementSystem
    // on the next tick. sceneManager.update() still gets real deltaTime
    // — it drives camera fly-through navigation, which should stay
    // responsive even while the simulation itself is paused.
    const simDeltaTime = this.editMode ? 0 : deltaTime;

    try {
      this.engine.tick(simDeltaTime);
      this.sceneManager.update(deltaTime, BOUNDARY_X, SPAWN_X, !this.editMode);
    } catch (e) {
      console.warn("Engine tick error — stopping render loop:", e);
      this.stop();
      return;
    }

    const activeCamera = this.getActiveCamera();
    if (this.editMode) {
      updateGridPosition(this.gridMesh, activeCamera.position);
      this.gizmo.update(
        activeCamera.quaternion,
        activeCamera instanceof THREE.OrthographicCamera,
      );
    }

    // Editor-only; an empty list (always the case in Runtime) detaches.
    this.transformGizmo.update(
      activeCamera,
      this.editMode ? this.gizmoTargetHandles : NO_GIZMO_TARGETS,
    );

    this.backend.render(this.threeScene, activeCamera);
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };
}
