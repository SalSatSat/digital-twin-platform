import * as THREE from "three/webgpu";
import { Engine } from "./engine";
import { RenderBackend } from "./backends/backend";
import { WebGLBackend } from "./backends/webgl";
import { WebGPUBackend } from "./backends/webgpu";

/**
 * Owns the Three.js scene, camera, and active render backend.
 * Reads entity state from Engine each frame and updates
 * the scene to match.
 *
 * Automatically selects WebGPU if available in the browser,
 * falling back to WebGL otherwise. The render loop is identical
 * regardless of which backend is active.
 */
export class Renderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private backend: RenderBackend;
  private mesh: THREE.Mesh | null = null;
  private entityHandle: number | null = null;

  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private engine: Engine,
  ) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.z = 5;

    // Select backend based on browser capability
    const hasWebGPU = !!navigator.gpu;
    this.backend = hasWebGPU
      ? new WebGPUBackend(canvas)
      : new WebGLBackend(canvas);

    console.log(`Render backend: ${hasWebGPU ? "WebGPU" : "WebGL (fallback)"}`);

    this.backend.setPixelRatio(window.devicePixelRatio);
    this.backend.setSize(window.innerWidth, window.innerHeight);

    // Event listeners
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
   * Sets up the initial scene contents.
   * Engine must already be initialized before calling this.
   */
  setup(): void {
    // Spawn one dynamic entity via the Engine
    this.entityHandle = this.engine.spawnDynamicObject(
      -3.0,
      0.0,
      0.0,
      1.0,
      0.0,
      0.0,
    );

    // Create a box mesh to represent the entity visually
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x4f9eed });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    // Lighting
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(2, 2, 2);
    this.scene.add(directional);
    this.scene.add(new THREE.AmbientLight(0x404040));
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
   * Cleans up Three.js and backend resources.
   * Does not dispose the Engine — the caller owns that lifecycle.
   */
  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    this.mesh?.geometry.dispose();
    if (this.mesh?.material instanceof THREE.Material) {
      this.mesh.material.dispose();
    }
    this.backend.dispose();
  }

  /**
   * Handles window resize.
   */
  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.backend.setSize(width, height);
  };

  /**
   * Handles keyboard input.
   * F — toggle fullscreen.
   */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "f" || event.key === "F") {
      if (!document.fullscreenElement) {
        this.canvas.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    }
  };

  /**
   * The render loop — advances ECS state and renders the scene.
   */
  private renderLoop = (currentTime: number): void => {
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    try {
      this.engine.tick(deltaTime);

      if (this.entityHandle !== null && this.mesh) {
        const position = this.engine.getPosition(this.entityHandle);
        if (position) {
          this.mesh.position.set(position[0], position[1], position[2]);
        }
      }
    } catch (e) {
      console.warn("Engine tick error — stopping render loop:", e);
      this.stop();
      return;
    }

    this.backend.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };
}
