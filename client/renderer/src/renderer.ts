import * as THREE from "three/webgpu";
import { Engine } from "./engine";
import { SceneManager } from "./scene-manager";
import { DEFAULT_SCENE } from "./scene";
import type { SceneDefinition } from "./scene";
import type { RenderBackend } from "./backends/backend";
import { WebGLBackend } from "./backends/webgl";
import { WebGPUBackend } from "./backends/webgpu";

const BOUNDARY_X = 4.0;
const SPAWN_X = -3.0;

/**
 * Owns the Three.js scene graph, render backend, and render loop.
 * Delegates all scene content management to SceneManager.
 *
 * The Renderer is responsible for:
 * - The render backend (WebGPU or WebGL)
 * - The render loop (requestAnimationFrame)
 * - Window resize and keyboard handling
 * - Selecting and using the active camera each frame
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

  // Fallback camera used before a scene is loaded
  private fallbackCamera: THREE.PerspectiveCamera;

  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;

  // Whether the simulation is paused for editing. When true, the ECS
  // tick receives a delta_time of 0 (holding physics/movement still),
  // while the scene sync (mesh transforms, camera controls) continues
  // to receive real delta_time so camera navigation stays responsive.
  private editMode: boolean = false;

  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, engine: Engine) {
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

    // ResizeObserver, not window "resize" — the canvas's own size can
    // change from layout shifts (e.g. side panels appearing/disappearing
    // when toggling edit mode) without the browser window itself
    // resizing. window.resize would miss that entirely.
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(canvas);
    window.addEventListener("keydown", this.onKeyDown);
  }

  /**
   * Initializes the render backend.
   * Must be awaited before calling setup().
   */
  async initialize(): Promise<void> {
    await this.backend.initialize();
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
    this.sceneManager.unloadScene();
    this.backend.dispose();
  }

  /**
   * Sets whether the simulation is paused for editing.
   *
   * While true, the ECS tick (MovementSystem, HierarchySystem) receives
   * a delta_time of 0 each frame, so Inspector edits to position aren't
   * immediately overwritten by simulation. Scene sync and camera
   * controls are unaffected — they keep receiving real delta_time so
   * camera fly-through navigation stays usable while paused.
   */
  setEditMode(enabled: boolean): void {
    this.editMode = enabled;
  }

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
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "f" || event.key === "F") {
      if (!document.fullscreenElement) {
        this.canvas.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    }
  };

  private getActiveCamera(): THREE.PerspectiveCamera {
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
      this.sceneManager.update(deltaTime, BOUNDARY_X, SPAWN_X);
    } catch (e) {
      console.warn("Engine tick error — stopping render loop:", e);
      this.stop();
      return;
    }

    this.backend.render(this.threeScene, this.getActiveCamera());
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };
}
