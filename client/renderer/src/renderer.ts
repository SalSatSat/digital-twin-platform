import * as THREE from "three/webgpu";
import { Engine } from "./engine";
import { RenderBackend } from "./backends/backend";
import { WebGLBackend } from "./backends/webgl";
import { WebGPUBackend } from "./backends/webgpu";

const BOUNDARY_X = 4.0;
const SPAWN_X = -3.0;

/**
 * Owns the Three.js scene and active render backend.
 * Reads entity and camera state from Engine each frame.
 *
 * Cameras are ECS entities — the Renderer reads their Transform
 * from the Engine and applies it to the corresponding Three.js camera.
 * The active camera determines the main viewport viewpoint.
 */
export class Renderer {
  private scene: THREE.Scene;
  private backend: RenderBackend;

  // Maps entity handle → Three.js mesh for regular entities
  private entityMeshMap: Map<number, THREE.Mesh> = new Map();

  // Maps camera handle → Three.js PerspectiveCamera
  private cameraMap: Map<number, THREE.PerspectiveCamera> = new Map();

  // The handle of the currently active camera
  private activeCameraHandle: number | null = null;

  // Fallback camera used if no ECS camera is active
  private fallbackCamera: THREE.PerspectiveCamera;

  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private engine: Engine,
  ) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    // Fallback camera — used until an ECS camera is set as active
    this.fallbackCamera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.fallbackCamera.position.z = 10;

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

  async initialize(): Promise<void> {
    await this.backend.initialize();
  }

  /**
   * Sets up the initial scene contents.
   * Spawns a Scene Camera (Editor context) and a Runtime Camera,
   * plus three dynamic entities to demonstrate multiple entities.
   */
  setup(): void {
    // Lighting
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(5, 5, 5);
    this.scene.add(directional);
    this.scene.add(new THREE.AmbientLight(0x404040));

    // Spawn Scene Camera — Editor context, positioned to view the scene
    const sceneCameraHandle = this.engine.spawnCamera(
      "Scene Camera",
      0.0,
      2.0,
      10.0,
      "Editor",
    );
    this.spawnVisualCamera(sceneCameraHandle);
    this.engine.setActiveCamera(sceneCameraHandle);
    this.activeCameraHandle = sceneCameraHandle;

    // Spawn Runtime Camera — Runtime context
    const runtimeCameraHandle = this.engine.spawnCamera(
      "Runtime Camera",
      0.0,
      5.0,
      15.0,
      "Runtime",
    );
    this.spawnVisualCamera(runtimeCameraHandle);

    // Spawn dynamic entities
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
   * Creates a Three.js PerspectiveCamera for an ECS camera entity.
   */
  private spawnVisualCamera(handle: number): void {
    const fov = this.engine.getCameraFov(handle) ?? 75;
    const camera = new THREE.PerspectiveCamera(
      fov,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );

    // Apply initial transform from ECS
    const transform = this.engine.getCameraTransform(handle);
    if (transform) {
      camera.position.set(transform[0], transform[1], transform[2]);
      camera.quaternion.set(
        transform[3],
        transform[4],
        transform[5],
        transform[6],
      );
    }

    this.cameraMap.set(handle, camera);
  }

  /**
   * Returns the currently active Three.js camera.
   * Falls back to the fallback camera if no ECS camera is active.
   */
  private getActiveCamera(): THREE.PerspectiveCamera {
    if (this.activeCameraHandle !== null) {
      const camera = this.cameraMap.get(this.activeCameraHandle);
      if (camera) return camera;
    }
    return this.fallbackCamera;
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

  start(): void {
    this.lastFrameTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  }

  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    for (const [handle] of this.entityMeshMap) {
      this.despawnVisualEntity(handle);
    }
    this.backend.dispose();
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;

    // Update all ECS cameras
    for (const camera of this.cameraMap.values()) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }

    // Update fallback camera
    this.fallbackCamera.aspect = aspect;
    this.fallbackCamera.updateProjectionMatrix();

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

  private renderLoop = (currentTime: number): void => {
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    try {
      this.engine.tick(deltaTime);

      // Sync ECS camera transforms to Three.js cameras
      for (const [handle, camera] of this.cameraMap) {
        const transform = this.engine.getCameraTransform(handle);
        if (transform) {
          camera.position.set(transform[0], transform[1], transform[2]);
          camera.quaternion.set(
            transform[3],
            transform[4],
            transform[5],
            transform[6],
          );
        }
      }

      // Update active camera handle from engine
      const activeHandle = this.engine.getActiveCamera();
      if (activeHandle !== undefined) {
        this.activeCameraHandle = activeHandle;
      }

      // Sync entity mesh positions and handle boundary respawn
      const toRespawn: Array<{ color: number; y: number; vx: number }> = [];

      for (const [handle, mesh] of this.entityMeshMap) {
        const position = this.engine.getPosition(handle);
        if (!position) continue;

        if (position[0] > BOUNDARY_X) {
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

    this.backend.render(this.scene, this.getActiveCamera());
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };
}
