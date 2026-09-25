import * as THREE from "three/webgpu";
import { Engine } from "./engine";
import type { SceneDefinition, CameraDefinition } from "./scene";
import { CameraControls } from "./camera/camera-controls";
import { CameraTween } from "./camera/camera-tween";
import { computePresetTransform } from "./gizmo/view-presets";
import type { ViewPreset } from "./gizmo/view-presets";

/**
 * The Three.js camera types a spawned camera entity can resolve to,
 * depending on its ECS ProjectionType variant (Perspective or
 * Orthographic — see engine/core/src/components/camera.rs).
 */
type SceneCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/**
 * Shape of the "Camera" component as returned by
 * Engine.getComponentJson(handle, "Camera") — mirrors the Rust
 * ProjectionType enum's serde (externally-tagged) JSON encoding.
 * Kept in sync by hand with camera.rs and CameraField.tsx, which
 * parses the identical shape for the Inspector.
 */
interface PerspectiveProjection {
  Perspective: { fov_degrees: number; near: number; far: number };
}
interface OrthographicProjection {
  Orthographic: { size: number; near: number; far: number };
}
type ProjectionJson = PerspectiveProjection | OrthographicProjection;
interface CameraComponentJson {
  projection: ProjectionJson;
}

// Fallback projection used if a camera's "Camera" component is
// missing or fails to parse — mirrors ProjectionType::default_perspective().
const DEFAULT_PROJECTION: ProjectionJson = {
  Perspective: { fov_degrees: 75, near: 0.1, far: 1000 },
};

/**
 * Tracks a spawned camera — its ECS handle and Three.js camera.
 */
interface SpawnedCamera {
  handle: number;
  camera: SceneCamera;
  isActive: boolean;
  context: CameraDefinition["context"];
  // Raw JSON of this camera's last-read "Camera" component, used to
  // cheaply detect projection changes (e.g. an Inspector edit
  // switching Perspective <-> Orthographic) each frame without a
  // deep comparison.
  lastProjectionJson: string;
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
  // Handle of the camera CameraControls is currently driving, so that
  // if that specific camera's Three.js object gets rebuilt mid-session
  // (a projection change), controls can be re-pointed at the new one.
  private controlledCameraHandle: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private engine: Engine;
  // In-progress view-gizmo camera snap, if any — see snapToPreset()
  // and the tween-stepping block in update().
  private activeTween: CameraTween | null = null;
  private tweenHandle: number | null = null;

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

      const projectionJson = this.engine.getComponentJson(handle, "Camera");
      const camera = this.buildCameraFromProjection(
        this.parseProjection(projectionJson),
        this.getAspect(),
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
        context: cameraDef.context,
        lastProjectionJson: projectionJson ?? "",
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

    const sceneCamera = this.getCameraForContext("Editor");
    if (!sceneCamera) return;

    this.controls = new CameraControls();
    this.controls.setCamera(sceneCamera.camera);
    this.controlledCameraHandle = sceneCamera.handle;
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
    this.controls.setOnUserInput(() => this.cancelTween());
    this.controls.attach(this.canvas);
  }

  /**
   * Smoothly moves the Editor camera to look at the world origin from
   * the given preset's side — called when the view gizmo's onAxisSelected
   * fires. Does nothing if there's no Editor camera to move.
   *
   * Any manual input on CameraControls cancels an in-progress snap
   * (see attachControls()'s setOnUserInput hook above) so a drag
   * always wins over a tween still finishing.
   */
  snapToPreset(preset: ViewPreset, distance = 10): void {
    const spawned = this.getCameraForContext("Editor");
    if (!spawned) return;

    const { position, quaternion } = computePresetTransform(preset, distance);
    this.activeTween = new CameraTween(
      spawned.camera.position,
      spawned.camera.quaternion,
      position,
      quaternion,
    );
    this.tweenHandle = spawned.handle;
  }

  /**
   * Flips the Editor camera between Perspective and Orthographic —
   * called when the view gizmo's center cube is clicked. Preserves
   * near/far; the entered mode's other parameter (fov_degrees or
   * size) resets to ProjectionType's own default, since the two
   * projections don't share a parameter to preserve across the flip.
   *
   * Reuses the exact same reflection path the Inspector's Projection
   * dropdown already writes through (engine.setComponentJson), and
   * CameraComponent's only field is `projection` (see camera.rs), so
   * this JSON is the complete component — nothing else to preserve.
   * The live projection-change poll already in update() picks this up
   * and rebuilds the Three.js camera the same way an Inspector edit
   * would, so no extra wiring is needed here beyond the write itself.
   */
  toggleEditorCameraProjection(): void {
    const spawned = this.getCameraForContext("Editor");
    if (!spawned) return;

    const projectionJson = this.engine.getComponentJson(
      spawned.handle,
      "Camera",
    );
    const projection = this.parseProjection(projectionJson);

    const next: ProjectionJson =
      "Perspective" in projection
        ? {
            Orthographic: {
              size: 10,
              near: projection.Perspective.near,
              far: projection.Perspective.far,
            },
          }
        : {
            Perspective: {
              fov_degrees: 75,
              near: projection.Orthographic.near,
              far: projection.Orthographic.far,
            },
          };

    this.engine.setComponentJson(
      spawned.handle,
      "Camera",
      JSON.stringify({ projection: next }),
    );
  }

  /**
   * Cancels an in-progress camera-preset snap, if any, and — if it
   * was driving the camera CameraControls is attached to — resyncs
   * CameraControls' internal `euler` state from the camera's current
   * (mid-tween) orientation. Without that resync, the next mouse-look
   * drag would compute from a stale euler and the view would jump;
   * see CameraControls.notifyInput()'s doc comment for the full story.
   * Guarded on activeTween being non-null so this never runs (and
   * never touches `euler`) during ordinary dragging with no tween in
   * flight — see the comment on that early return below.
   */
  private cancelTween(): void {
    if (!this.activeTween) return;
    if (this.tweenHandle === this.controlledCameraHandle) {
      const spawned = this.spawnedCameras.find(
        (c) => c.handle === this.tweenHandle,
      );
      if (spawned) this.controls?.setCamera(spawned.camera);
    }
    this.activeTween = null;
    this.tweenHandle = null;
  }

  /**
   * Detaches and disposes camera controls.
   */
  detachControls(): void {
    this.controls?.detach();
    this.controls = null;
    this.controlledCameraHandle = null;
    this.activeTween = null;
    this.tweenHandle = null;
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
   * Returns the Three.js camera for the given render context — the
   * Editor-context camera while editing, the Runtime-context camera
   * otherwise. Falls back to a Universal-context camera if no
   * context-specific camera exists. Returns null if none match.
   */
  getActiveCamera(context: "Editor" | "Runtime"): SceneCamera | null {
    return this.getCameraForContext(context)?.camera ?? null;
  }

  /**
   * Finds the camera to use for a given render context. Prefers an
   * exact context match (tie-broken by isActive, then first spawned),
   * falling back to a Universal-context camera under the same rule.
   */
  private getCameraForContext(
    context: "Editor" | "Runtime",
  ): SpawnedCamera | undefined {
    const exact = this.spawnedCameras.filter((c) => c.context === context);
    const chosen = exact.find((c) => c.isActive) ?? exact[0];
    if (chosen) return chosen;

    const universal = this.spawnedCameras.filter(
      (c) => c.context === "Universal",
    );
    return universal.find((c) => c.isActive) ?? universal[0];
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
   * Handles boundary despawn and respawn for dynamic entities, but only
   * while the simulation is running (respawnEnabled). Boundary respawn is
   * runtime logic — in edit mode it would destroy and recreate an entity
   * (new handle, velocity reset) just because an Inspector edit moved it
   * past the boundary.
   */
  update(
    deltaTime: number,
    boundaryX: number,
    spawnX: number,
    respawnEnabled: boolean,
  ): void {
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

      if (respawnEnabled && position[0] > boundaryX) {
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
        const rotation = this.engine.getRotation(spawned.handle);
        if (rotation) {
          spawned.mesh.quaternion.set(
            rotation[0],
            rotation[1],
            rotation[2],
            rotation[3],
          );
        }
        const visible = this.engine.getVisible(spawned.handle);
        if (visible !== undefined) {
          spawned.mesh.visible = visible;
        }
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

    // Step any in-progress camera-preset snap (from the view gizmo)
    // and apply it directly, then write it back to the ECS the same
    // way CameraControls does — writing to ECS as well (rather than
    // just mutating the Three.js camera) keeps the ECS authoritative
    // even mid-tween, e.g. if the Inspector happens to be open on
    // this camera's LocalTransform while it's snapping.
    if (this.activeTween && this.tweenHandle !== null) {
      const { position, quaternion, done } = this.activeTween.step(deltaTime);
      this.engine.setCameraTransform(
        this.tweenHandle,
        position.x,
        position.y,
        position.z,
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
      );

      const spawned = this.spawnedCameras.find(
        (c) => c.handle === this.tweenHandle,
      );
      if (spawned) {
        spawned.camera.position.copy(position);
        spawned.camera.quaternion.copy(quaternion);
      }

      if (done) {
        // Resync CameraControls' euler from the final orientation —
        // see cancelTween()'s doc comment for why this matters.
        if (spawned && this.tweenHandle === this.controlledCameraHandle) {
          this.controls?.setCamera(spawned.camera);
        }
        this.activeTween = null;
        this.tweenHandle = null;
      }
    }

    // Sync camera transforms and projections from ECS. Projection is
    // checked every frame (cheap string compare against the last-seen
    // JSON) so an Inspector edit that flips a camera between
    // Perspective and Orthographic — or tweaks its fov/size/near/far —
    // takes effect live, not just at scene load.
    for (const spawned of this.spawnedCameras) {
      const projectionJson = this.engine.getComponentJson(
        spawned.handle,
        "Camera",
      );
      if (projectionJson && projectionJson !== spawned.lastProjectionJson) {
        const rebuilt = this.buildCameraFromProjection(
          this.parseProjection(projectionJson),
          this.getAspect(),
        );
        rebuilt.position.copy(spawned.camera.position);
        rebuilt.quaternion.copy(spawned.camera.quaternion);
        spawned.camera = rebuilt;
        spawned.lastProjectionJson = projectionJson;

        if (spawned.handle === this.controlledCameraHandle) {
          this.controls?.setCamera(rebuilt);
        }
      }

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
      if (spawned.camera instanceof THREE.OrthographicCamera) {
        // Orthographic "size" is the half-height (see
        // buildOrthographicCamera) — recovered here from the current
        // `top` rather than tracked separately, since top === size by
        // construction and never changes except on a projection
        // rebuild. Only left/right need to change with aspect.
        const halfHeight = spawned.camera.top;
        spawned.camera.left = -halfHeight * aspect;
        spawned.camera.right = halfHeight * aspect;
      } else {
        spawned.camera.aspect = aspect;
      }
      spawned.camera.updateProjectionMatrix();
    }
  }

  /**
   * Casts a ray from NDC coordinates through the given camera and
   * returns the handle of the closest visible entity hit, or null if
   * nothing was hit. Editor-only in practice — callers gate this on
   * edit mode; SceneManager itself has no notion of modes.
   */
  pickEntity(ndc: THREE.Vector2, camera: SceneCamera): number | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const meshes = this.spawnedEntities
      .filter((s) => s.mesh.visible)
      .map((s) => s.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;

    const spawned = this.spawnedEntities.find((s) => s.mesh === hits[0].object);
    return spawned?.handle ?? null;
  }

  /**
   * Returns the name of the active scene, or null if none is loaded.
   */
  get sceneName(): string | null {
    return this.activeSceneDef?.name ?? null;
  }

  /**
   * Parses a "Camera" component's JSON into its ProjectionJson shape.
   * Falls back to a default perspective projection if the JSON is
   * missing, malformed, or lacks a `projection` field — this should
   * only happen for a camera entity missing its Camera component,
   * which spawnCamera() should never produce, but the fallback keeps
   * loadScene()/update() from throwing on unexpected data.
   */
  private parseProjection(json: string | undefined): ProjectionJson {
    if (json) {
      try {
        const parsed = JSON.parse(json) as CameraComponentJson;
        if (parsed.projection) return parsed.projection;
      } catch {
        // Falls through to the default below.
      }
    }
    return DEFAULT_PROJECTION;
  }

  /**
   * Constructs the Three.js camera matching a ProjectionJson variant.
   */
  private buildCameraFromProjection(
    projection: ProjectionJson,
    aspect: number,
  ): SceneCamera {
    if ("Perspective" in projection) {
      const { fov_degrees, near, far } = projection.Perspective;
      return new THREE.PerspectiveCamera(fov_degrees, aspect, near, far);
    }
    const { size, near, far } = projection.Orthographic;
    return this.buildOrthographicCamera(size, aspect, near, far);
  }

  /**
   * Builds an orthographic camera from the ECS's `size` parameter
   * (half-height of the view volume in world units — see
   * ProjectionType::Orthographic in camera.rs) and the current aspect
   * ratio.
   */
  private buildOrthographicCamera(
    size: number,
    aspect: number,
    near: number,
    far: number,
  ): THREE.OrthographicCamera {
    return new THREE.OrthographicCamera(
      -size * aspect,
      size * aspect,
      size,
      -size,
      near,
      far,
    );
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
    if (!this.canvas || this.canvas.clientHeight === 0) return 1;
    return this.canvas.clientWidth / this.canvas.clientHeight;
  }
}
