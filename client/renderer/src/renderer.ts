import * as THREE from "three/webgpu";
import { Engine } from "./engine";
import { SceneManager } from "./scene-manager";
import { SceneDefinition, DEFAULT_SCENE } from "./scene";
import { RenderBackend } from "./backends/backend";
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

  // Fallback camera used before a scene is loaded
  private fallbackCamera: THREE.PerspectiveCamera;

  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private engine: Engine,
  ) {
    this.threeScene = new THREE.Scene();
    this.threeScene.background = new THREE.Color(0x1a1a1a);

    this.fallbackCamera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
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
    this.backend.setSize(window.innerWidth, window.innerHeight);

    window.addEventListener("resize", this.onResize);
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
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    this.sceneManager.unloadScene();
    this.backend.dispose();
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;

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
    return this.sceneManager.getActiveCamera() ?? this.fallbackCamera;
  }

  private renderLoop = (currentTime: number): void => {
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    try {
      this.engine.tick(deltaTime);
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
