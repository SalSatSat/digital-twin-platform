import * as THREE from "three";
import init, { EngineWorld } from "dt-engine-wasm";

export const RENDERER_VERSION = "0.1.0";

/**
 * Renderer owns the Three.js scene, camera, and WebGL renderer.
 * It also owns the WASM EngineWorld and drives the tick loop that
 * keeps rendered objects in sync with ECS state.
 *
 * This is a temporary design for proving the ECS-to-render pipeline
 * works end to end. Ownership of the ECS may be separated from
 * rendering concerns in a future phase.
 */
export class Renderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private webglRenderer: THREE.WebGLRenderer;
  private engineWorld: EngineWorld | null = null;
  private entityHandle: number | null = null;
  private mesh: THREE.Mesh | null = null;

  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private isInitialized: boolean = false;

  constructor(private canvas: HTMLCanvasElement) {
    // Scene — the container for everything we render
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    // Camera — perspective camera looking at the origin
    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    this.camera.position.z = 5;

    // Renderer — draws the scene to the canvas
    this.webglRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.webglRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  /**
   * Initializes the WASM engine and spawns a single dynamic entity.
   * Must be called and awaited before start().
   */
  async initialize(): Promise<void> {
    // Load the WASM module — must happen before EngineWorld can be used
    await init();

    this.engineWorld = new EngineWorld();

    // Spawn one entity moving along the X axis at 1 unit per second
    this.entityHandle = this.engineWorld.spawn_dynamic_object(
      -3.0,
      0.0,
      0.0, // starting position
      1.0,
      0.0,
      0.0, // velocity
    );

    // Create a simple box to represent the entity visually
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x4f9eed });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    // Basic lighting so the box is visible with shading
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(2, 2, 2);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x404040));

    this.isInitialized = true;
  }

  /**
   * Begins the render loop. The loop ticks the ECS each frame,
   * reads the updated position, and renders the scene.
   */
  start(): void {
    if (!this.isInitialized) {
      throw new Error("Renderer.start() called before initialize() completed");
    }

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
   * Cleans up Three.js and WASM resources.
   * Call this when the renderer is no longer needed.
   */
  dispose(): void {
    this.stop();
    this.mesh?.geometry.dispose();
    if (this.mesh?.material instanceof THREE.Material) {
      this.mesh.material.dispose();
    }
    this.webglRenderer.dispose();
    this.engineWorld?.free();
  }

  /**
   * The render loop — runs once per animation frame.
   * Ticks the ECS, reads back the updated position, and renders.
   */
  private renderLoop = (currentTime: number): void => {
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    if (this.engineWorld && this.entityHandle !== null && this.mesh) {
      // Advance the ECS by one tick
      this.engineWorld.tick(deltaTime);

      // Read the updated position and apply it to the mesh
      const position = this.engineWorld.get_position(this.entityHandle);
      if (position) {
        this.mesh.position.set(position[0], position[1], position[2]);
      }
    }

    this.webglRenderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };
}
