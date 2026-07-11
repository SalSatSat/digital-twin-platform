import * as THREE from "three/webgpu";
import { Engine } from "./engine";
import { RenderBackend } from "./backends/backend";
import { WebGLBackend } from "./backends/webgl";
import { WebGPUBackend } from "./backends/webgpu";

// The X boundary at which an entity is despawned and respawned
const BOUNDARY_X = 4.0;
const SPAWN_X = -3.0;

/**
 * Owns the Three.js scene, camera, and active render backend.
 * Reads entity state from Engine each frame and updates
 * the scene to match.
 *
 * Maintains a map of entity handle → Three.js mesh. When an entity
 * is spawned, a mesh is created. When an entity is despawned, its
 * mesh is removed. The render loop iterates all tracked entities.
 */
export class Renderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private backend: RenderBackend;

  // Maps entity handle → Three.js mesh
  private entityMeshMap: Map<number, THREE.Mesh> = new Map();

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
    this.camera.position.z = 10;

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
    // Add lighting
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(5, 5, 5);
    this.scene.add(directional);
    this.scene.add(new THREE.AmbientLight(0x404040));

    // Spawn multiple dynamic entities at different positions
    // with different velocities and colors
    const entityConfigs = [
      { x: -3.0, y: 1.5, z: 0.0, vx: 1.0, vy: 0.0, vz: 0.0, color: 0x4f9eed },
      { x: -3.0, y: 0.0, z: 0.0, vx: 1.5, vy: 0.0, vz: 0.0, color: 0x48bb78 },
      { x: -3.0, y: -1.5, z: 0.0, vx: 0.8, vy: 0.0, vz: 0.0, color: 0xf6ad55 },
    ];

    for (const config of entityConfigs) {
      const handle = this.engine.spawnDynamicObject(
        config.x,
        config.y,
        config.z,
        config.vx,
        config.vy,
        config.vz,
      );
      this.spawnVisualEntity(handle, config.color);
    }
  }

  /**
   * Creates a Three.js mesh for an entity and tracks it.
   */
  private spawnVisualEntity(handle: number, color: number): void {
    const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const material = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);
    this.entityMeshMap.set(handle, mesh);
  }

  /**
   * Removes a Three.js mesh for an entity and stops tracking it.
   */
  private despawnVisualEntity(handle: number): void {
    const mesh = this.entityMeshMap.get(handle);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
      this.entityMeshMap.delete(handle);
    }
    this.engine.despawnEntity(handle);
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
   * Cleans up all Three.js and backend resources.
   * Does not dispose the Engine — the caller owns that lifecycle.
   */
  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);

    // Clean up all tracked meshes
    for (const [handle] of this.entityMeshMap) {
      this.despawnVisualEntity(handle);
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
   * The render loop — advances ECS state, syncs mesh positions,
   * handles entity boundary despawn/respawn, and renders the scene.
   */
  private renderLoop = (currentTime: number): void => {
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    try {
      this.engine.tick(deltaTime);

      // Collect handles to respawn after iterating
      const toRespawn: Array<{ color: number; y: number; vx: number }> = [];

      for (const [handle, mesh] of this.entityMeshMap) {
        const position = this.engine.getPosition(handle);
        if (!position) continue;

        if (position[0] > BOUNDARY_X) {
          // Store the entity's visual config before despawning
          const color = (
            mesh.material as THREE.MeshStandardMaterial
          ).color.getHex();
          const y = mesh.position.y;
          const vx = (position[0] - mesh.position.x) / deltaTime;
          toRespawn.push({ color, y, vx: Math.abs(vx) });
          this.despawnVisualEntity(handle);
        } else {
          mesh.position.set(position[0], position[1], position[2]);
        }
      }

      // Respawn entities that crossed the boundary
      for (const config of toRespawn) {
        const newHandle = this.engine.spawnDynamicObject(
          SPAWN_X,
          config.y,
          0.0,
          config.vx,
          0.0,
          0.0,
        );
        this.spawnVisualEntity(newHandle, config.color);
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
