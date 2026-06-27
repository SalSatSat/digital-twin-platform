import * as THREE from "three";
import { Engine } from "./engine";

/**
 * Owns the Three.js scene, camera, and WebGL renderer.
 * Reads entity state from Engine each frame and updates
 * the scene to match.
 *
 * Renderer has no knowledge of ECS internals — it only
 * reads positions and other visual data from Engine via
 * its public API.
 */
export class Renderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private webglRenderer: THREE.WebGLRenderer;
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

    // Camera — use window dimensions for correct initial sizing
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.z = 5;

    // WebGL Renderer — use window dimensions
    this.webglRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.webglRenderer.setPixelRatio(window.devicePixelRatio);
    this.webglRenderer.setSize(window.innerWidth, window.innerHeight);

    // Resize handler
    window.addEventListener("resize", this.onResize);

    // Fullscreen handler
    window.addEventListener("keydown", this.onKeyDown);
  }

  /**
   * Handles window resize — updates renderer size and camera aspect ratio.
   */
  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.webglRenderer.setSize(width, height);
  };

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
   * Cleans up Three.js resources.
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
    this.webglRenderer.dispose();
  }

  /**
   * The render loop — advances ECS state and renders the scene.
   */
  private renderLoop = (currentTime: number): void => {
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    // Tick the ECS via Engine
    this.engine.tick(deltaTime);

    // Read updated position and apply to mesh
    if (this.entityHandle !== null && this.mesh) {
      const position = this.engine.getPosition(this.entityHandle);
      if (position) {
        this.mesh.position.set(position[0], position[1], position[2]);
      }
    }

    this.webglRenderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };

  /**
   * Toggles fullscreen mode on the canvas element.
   * Press F to enter fullscreen, Escape to exit (built into the browser).
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
}
