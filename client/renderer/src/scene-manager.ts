import * as THREE from "three/webgpu";
import { Engine } from "./engine";
import type { SceneDefinition } from "./scene";
import { CameraControls } from "./camera-controls";

/**
 * Tracks a spawned camera — its ECS handle and Three.js camera.
 */
interface SpawnedCamera {
  handle: number;
  camera: THREE.PerspectiveCamera;
  isActive: boolean;
}

/**
 * Tracks a spawned entity — its ECS handle and Three.js mesh.
 */
interface SpawnedEntity {
  handle: number;
  name: string;
  mesh: THREE.Mesh;
}

/**
 * Manages the active scene — spawning and despawning entities,
 * cameras, and lights as scenes are loaded and unloaded.
 *
 * SceneManager is the bridge between a SceneDefinition (pure data)
 * and the runtime state in the Engine and Three.js scene.
 *
 * The Renderer delegates all scene content management to SceneManager.
 * The Renderer itself only owns rendering infrastructure —
 * backend, camera selection, and the render loop.
 */
export class SceneManager {
  private threeScene: THREE.Scene;
  private spawnedCameras: SpawnedCamera[] = [];
  private spawnedEntities: SpawnedEntity[] = [];
  private spawnedLights: THREE.Light[] = [];
  private activeSceneDef: SceneDefinition | null = null;
  private controls: CameraControls | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private engine: Engine;

  constructor(
    engine: Engine,
    threeScene: THREE.Scene,
    canvas: HTMLCanvasElement,
  ) {
    this.engine = engine;
    this.threeScene = threeScene;
    this.canvas = canvas;
  }

  /**
   * Loads a scene definition — spawns all cameras, lights, and entities.
   * If a scene is already loaded, it is unloaded first.
   */
  loadScene(definition: SceneDefinition): void {
    if (this.activeSceneDef) {
      this.unloadScene();
    }

    this.activeSceneDef = definition;

    // Spawn cameras
    for (const cameraDef of definition.cameras) {
      const handle = this.engine.spawnCamera(
        cameraDef.name,
        cameraDef.position.x,
        cameraDef.position.y,
        cameraDef.position.z,
        cameraDef.context,
      );

      const fov = this.engine.getCameraFov(handle) ?? 75;
      const camera = new THREE.PerspectiveCamera(
        fov,
        this.getAspect(),
        0.1,
        1000,
      );

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

      this.spawnedCameras.push({
        handle,
        camera,
        isActive: cameraDef.isActive ?? false,
      });

      if (cameraDef.isActive) {
        this.engine.setActiveCamera(handle);
      }
    }

    // Add lights
    for (const lightDef of definition.lights) {
      const light = this.createLight(lightDef);
      this.threeScene.add(light);
      this.spawnedLights.push(light);
    }

    // Spawn dynamic entities
    for (const entityDef of definition.dynamicEntities) {
      const name = entityDef.name;
      const handle = this.engine.spawnDynamicObject(
        name,
        entityDef.position.x,
        entityDef.position.y,
        entityDef.position.z,
        entityDef.velocity.x,
        entityDef.velocity.y,
        entityDef.velocity.z,
      );
      const mesh = this.createMesh(entityDef.color);
      this.threeScene.add(mesh);
      this.spawnedEntities.push({ handle, name, mesh });
    }

    // Spawn static entities
    for (const entityDef of definition.staticEntities) {
      const name = entityDef.name;
      const handle = this.engine.spawnStaticObject(
        name,
        entityDef.position.x,
        entityDef.position.y,
        entityDef.position.z,
      );
      const mesh = this.createMesh(entityDef.color);
      mesh.position.set(
        entityDef.position.x,
        entityDef.position.y,
        entityDef.position.z,
      );
      this.threeScene.add(mesh);
      this.spawnedEntities.push({ handle, name, mesh });
    }

    console.log(
      `Scene loaded: "${definition.name}" — ` +
        `${this.spawnedCameras.length} cameras, ` +
        `${this.spawnedLights.length} lights, ` +
        `${this.spawnedEntities.length} entities`,
    );
  }

  /**
   * Attaches camera controls to the active Scene Camera.
   * Controls write camera transform back to the ECS each frame.
   */
  attachControls(): void {
    if (!this.canvas) return;

    const sceneCamera = this.spawnedCameras.find((c) => c.isActive);
    if (!sceneCamera) return;

    this.controls = new CameraControls();
    this.controls.setCamera(sceneCamera.camera);
    this.controls.setWriteBack((x, y, z, rx, ry, rz, rw) => {
      this.engine.setCameraTransform(
        sceneCamera.handle,
        x,
        y,
        z,
        rx,
        ry,
        rz,
        rw,
      );
    });
    this.controls.attach(this.canvas);
  }

  /**
   * Detaches and disposes camera controls.
   */
  detachControls(): void {
    this.controls?.detach();
    this.controls = null;
  }

  /**
   * Unloads the active scene — despawns all entities and cameras,
   * removes all lights.
   */
  unloadScene(): void {
    this.detachControls();

    // Despawn entities
    for (const spawned of this.spawnedEntities) {
      this.engine.despawnEntity(spawned.handle);
      this.threeScene.remove(spawned.mesh);
      spawned.mesh.geometry.dispose();
      if (spawned.mesh.material instanceof THREE.Material) {
        spawned.mesh.material.dispose();
      }
    }
    this.spawnedEntities = [];

    // Despawn cameras
    for (const spawned of this.spawnedCameras) {
      this.engine.despawnEntity(spawned.handle);
    }
    this.spawnedCameras = [];

    // Remove lights
    for (const light of this.spawnedLights) {
      this.threeScene.remove(light);
    }
    this.spawnedLights = [];

    this.activeSceneDef = null;
    console.log("Scene unloaded.");
  }

  /**
   * Returns the active Three.js camera.
   * Returns null if no scene is loaded or no camera is active.
   */
  getActiveCamera(): THREE.PerspectiveCamera | null {
    const activeHandle = this.engine.getActiveCamera();
    if (activeHandle === undefined) return null;
    const spawned = this.spawnedCameras.find((c) => c.handle === activeHandle);
    return spawned?.camera ?? null;
  }

  /**
   * Returns all spawned cameras with their handles and active state.
   */
  getCameras(): SpawnedCamera[] {
    return this.spawnedCameras;
  }

  /**
   * Sets the active camera by handle and updates the engine.
   */
  setActiveCamera(handle: number): void {
    this.engine.setActiveCamera(handle);
    for (const spawned of this.spawnedCameras) {
      spawned.isActive = spawned.handle === handle;
    }
  }

  /**
   * Updates all entity mesh positions from the ECS each frame.
   * Handles boundary despawn and respawn for dynamic entities.
   */
  update(deltaTime: number, boundaryX: number, spawnX: number): void {
    // Update camera controls
    this.controls?.update(deltaTime);

    const toRespawn: Array<{
      name: string;
      color: number;
      y: number;
      vx: number;
      vy: number;
      vz: number;
    }> = [];

    for (const spawned of this.spawnedEntities) {
      const position = this.engine.getPosition(spawned.handle);
      if (!position) continue;

      if (position[0] > boundaryX) {
        const name = spawned.name;
        const color = (
          spawned.mesh.material as THREE.MeshStandardMaterial
        ).color.getHex();
        toRespawn.push({
          name,
          color,
          y: spawned.mesh.position.y,
          vx: 1.0,
          vy: 0.0,
          vz: 0.0,
        });
        this.engine.despawnEntity(spawned.handle);
        this.threeScene.remove(spawned.mesh);
        spawned.mesh.geometry.dispose();
        if (spawned.mesh.material instanceof THREE.Material) {
          spawned.mesh.material.dispose();
        }
      } else {
        spawned.mesh.position.set(position[0], position[1], position[2]);
      }
    }

    // Remove despawned entities from tracking
    this.spawnedEntities = this.spawnedEntities.filter(
      (s) => this.engine.getPosition(s.handle) !== undefined,
    );

    // Respawn entities that crossed the boundary
    for (const config of toRespawn) {
      const name = config.name;
      const handle = this.engine.spawnDynamicObject(
        name,
        spawnX,
        config.y,
        0.0,
        config.vx,
        config.vy,
        config.vz,
      );
      const mesh = this.createMesh(config.color);
      mesh.position.set(spawnX, config.y, 0.0);
      this.threeScene.add(mesh);
      this.spawnedEntities.push({ handle, name, mesh });
    }

    // Sync camera transforms from ECS
    for (const spawned of this.spawnedCameras) {
      const transform = this.engine.getCameraTransform(spawned.handle);
      if (transform) {
        spawned.camera.position.set(transform[0], transform[1], transform[2]);
        spawned.camera.quaternion.set(
          transform[3],
          transform[4],
          transform[5],
          transform[6],
        );
      }
    }
  }

  /**
   * Updates all camera aspect ratios on window resize.
   */
  onResize(): void {
    const aspect = this.getAspect();
    for (const spawned of this.spawnedCameras) {
      spawned.camera.aspect = aspect;
      spawned.camera.updateProjectionMatrix();
    }
  }

  /**
   * Returns the name of the active scene, or null if none is loaded.
   */
  get sceneName(): string | null {
    return this.activeSceneDef?.name ?? null;
  }

  private createMesh(color: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const material = new THREE.MeshStandardMaterial({ color });
    return new THREE.Mesh(geometry, material);
  }

  private createLight(def: {
    type: string;
    color: number;
    intensity: number;
    position?: { x: number; y: number; z: number };
  }): THREE.Light {
    switch (def.type) {
      case "directional": {
        const light = new THREE.DirectionalLight(def.color, def.intensity);
        if (def.position) {
          light.position.set(def.position.x, def.position.y, def.position.z);
        }
        return light;
      }
      case "point": {
        const light = new THREE.PointLight(def.color, def.intensity);
        if (def.position) {
          light.position.set(def.position.x, def.position.y, def.position.z);
        }
        return light;
      }
      case "ambient":
      default:
        return new THREE.AmbientLight(def.color, def.intensity);
    }
  }

  private getAspect(): number {
    return window.innerWidth / window.innerHeight;
  }
}
