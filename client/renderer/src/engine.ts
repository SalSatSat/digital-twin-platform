import init, { EngineWorld } from "dt-engine-wasm";

// ── Errors ────────────────────────────────────────────────
/**
 * Thrown by hierarchy-mutating methods (setParent, removeParent) when
 * the operation is rejected by the ECS. Wraps the message thrown across
 * the WASM boundary — Rust's HierarchyError becomes a JS exception
 * rather than a status code, since callers (the Inspector) need the
 * actual reason, not just pass/fail.
 */
export class HierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HierarchyError";
  }
}

/**
 * Thrown by setComponentJson when a write is rejected — bad JSON shape,
 * or a semantic validation failure (e.g. "near must be less than far",
 * an unregistered category). The message is meant to be shown to the
 * user directly in the Inspector, not just logged.
 */
export class ReflectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReflectionError";
  }
}

/**
 * Owns the WASM-compiled ECS and exposes a clean API for
 * advancing state and reading entity data.
 *
 * Engine is the single source of truth for all entity state.
 * It is intentionally decoupled from rendering concerns —
 * it has no knowledge of Three.js, cameras, or the DOM.
 *
 * Consumers (renderers, editor panels, debug tools) read from
 * Engine but do not own it. Engine is created once and shared.
 */
export class Engine {
  private engineWorld: EngineWorld | null = null;
  private initialized = false;

  // ── Lifecycle ─────────────────────────────────────────────
  /**
   * Loads the WASM module and creates the ECS world.
   * Must be awaited before calling any other method.
   */
  async initialize(): Promise<void> {
    await init();
    this.engineWorld = new EngineWorld();
    this.initialized = true;
  }

  /**
   * Releases WASM resources. Call when the Engine is no longer needed.
   */
  dispose(): void {
    this.engineWorld?.free();
    this.engineWorld = null;
    this.initialized = false;
  }

  private assertInitialized(): void {
    if (!this.initialized || !this.engineWorld) {
      throw new Error(
        "Engine has not been initialized. Call and await initialize() first.",
      );
    }
  }

  // ── Entities ──────────────────────────────────────────────
  /**
   * Spawns a dynamic entity — has both position and velocity.
   * Returns a handle for referencing this entity later.
   */
  spawnDynamicObject(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ): number {
    this.assertInitialized();
    return this.engineWorld!.spawn_dynamic_object(x, y, z, vx, vy, vz);
  }

  /**
   * Spawns a static entity — has position only, does not move.
   * Returns a handle for referencing this entity later.
   */
  spawnStaticObject(x: number, y: number, z: number): number {
    this.assertInitialized();
    return this.engineWorld!.spawn_static_object(x, y, z);
  }

  /**
   * Despawns an entity by handle, freeing its ECS memory.
   * The handle slot becomes available for reuse.
   * Returns true if the entity existed and was despawned.
   */
  despawnEntity(handle: number): boolean {
    this.assertInitialized();
    return this.engineWorld!.despawn_entity(handle);
  }

  /**
   * Returns the total number of entities in the world.
   */
  entityCount(): number {
    this.assertInitialized();
    return this.engineWorld!.entity_count();
  }

  /**
   * Returns the world-space position of an entity as [x, y, z].
   * Returns undefined if the handle is invalid or the entity
   * has no WorldTransform component.
   */
  getPosition(handle: number): Float32Array | undefined {
    this.assertInitialized();
    return this.engineWorld!.get_position(handle) ?? undefined;
  }

  /**
   * Advances the ECS by one tick.
   * delta_time is elapsed time in seconds since the last tick.
   */
  tick(deltaTime: number): void {
    this.assertInitialized();
    this.engineWorld!.tick(deltaTime);
  }

  // ── Cameras ───────────────────────────────────────────────
  /**
   * Spawns a perspective camera entity at the given position.
   * Returns a handle for referencing this camera later.
   *
   * context should be one of: "Editor", "Runtime", "Universal"
   */
  spawnCamera(
    name: string,
    x: number,
    y: number,
    z: number,
    context: string,
  ): number {
    this.assertInitialized();
    return this.engineWorld!.spawn_camera(name, x, y, z, context);
  }

  /**
   * Sets the active camera by handle.
   * The active camera is used by the renderer as the main viewpoint.
   */
  setActiveCamera(handle: number): void {
    this.assertInitialized();
    this.engineWorld!.set_active_camera(handle);
  }

  /**
   * Returns the handle of the currently active camera.
   * Returns undefined if no active camera has been set.
   */
  getActiveCamera(): number | undefined {
    this.assertInitialized();
    return this.engineWorld!.get_active_camera() ?? undefined;
  }

  /**
   * Returns the transform of a camera as [px, py, pz, rx, ry, rz, rw].
   * position (x,y,z) and rotation quaternion (x,y,z,w).
   * Returns undefined if the handle is invalid.
   */
  getCameraTransform(handle: number): Float32Array | undefined {
    this.assertInitialized();
    return this.engineWorld!.get_camera_transform(handle) ?? undefined;
  }

  /**
   * Returns the field of view in degrees for a perspective camera.
   * Returns undefined if the handle is invalid or camera is not perspective.
   */
  getCameraFov(handle: number): number | undefined {
    this.assertInitialized();
    return this.engineWorld!.get_camera_fov(handle) ?? undefined;
  }

  /**
   * Sets the position and rotation of a camera entity.
   * Used to write camera transform back to the ECS after
   * the user moves the camera via controls.
   *
   * rotation is a quaternion [rx, ry, rz, rw]
   */
  setCameraTransform(
    handle: number,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    rw: number,
  ): void {
    this.assertInitialized();
    this.engineWorld!.set_camera_transform(handle, x, y, z, rx, ry, rz, rw);
  }

  // ── Hierarchy ─────────────────────────────────────────────
  /**
   * Sets childHandle's parent to parentHandle.
   *
   * Idempotent: setting a child's parent to its current parent is a
   * no-op that succeeds without side effects.
   *
   * Throws HierarchyError if either handle is invalid, or if the
   * operation would create a cycle (parentHandle is childHandle
   * itself, or a descendant of childHandle).
   */
  setParent(childHandle: number, parentHandle: number): void {
    this.assertInitialized();
    const status = this.engineWorld!.set_parent(childHandle, parentHandle);
    switch (status) {
      case 0:
        return;
      case 1:
        throw new HierarchyError(
          `setParent failed: entity not found (child=${childHandle}, parent=${parentHandle})`,
        );
      case 2:
        throw new HierarchyError(
          `setParent failed: would create a cycle (child=${childHandle}, parent=${parentHandle})`,
        );
      default:
        throw new HierarchyError(
          `setParent failed: unknown status code ${status}`,
        );
    }
  }

  /**
   * Removes childHandle's parent, making it a root entity.
   * No-op if already a root.
   *
   * Throws HierarchyError if childHandle is invalid.
   */
  removeParent(childHandle: number): void {
    this.assertInitialized();
    const status = this.engineWorld!.remove_parent(childHandle);
    switch (status) {
      case 0:
        return;
      case 1:
        throw new HierarchyError(
          `removeParent failed: entity not found (child=${childHandle})`,
        );
      default:
        throw new HierarchyError(
          `removeParent failed: unknown status code ${status}`,
        );
    }
  }

  // ── Components (Inspector reflection) ────────────────────
  /**
   * Returns the reflectable component kinds present on an entity,
   * as string names (e.g. "LocalTransform", "Camera"). Empty array
   * if the handle is invalid or despawned.
   */
  listComponents(handle: number): string[] {
    this.assertInitialized();
    return this.engineWorld!.list_components(handle);
  }

  /**
   * Returns a component's current value as a JSON string, or
   * undefined if the handle is invalid, kind is unrecognized, or
   * the entity doesn't have that component.
   *
   * Callers should JSON.parse() the result — kept as a string here
   * rather than parsed, since the shape varies per component kind
   * and this layer doesn't know about that shape.
   */
  getComponentJson(handle: number, kind: string): string | undefined {
    this.assertInitialized();
    return this.engineWorld!.get_component_json(handle, kind) ?? undefined;
  }

  /**
   * Writes a component's value from a JSON string.
   *
   * Throws ReflectionError if the JSON is malformed, the entity/kind
   * is invalid, or the value fails validation (e.g. camera near >= far,
   * an unregistered EntityInfo category). The error message is meant
   * to be shown directly to the user.
   */
  setComponentJson(handle: number, kind: string, json: string): void {
    this.assertInitialized();
    const rejection = this.engineWorld!.set_component_json(handle, kind, json);
    if (rejection !== undefined) {
      throw new ReflectionError(rejection);
    }
  }

  /**
   * Returns all registered entity categories as JSON, for populating
   * the Inspector's category dropdown. Includes built-ins and any
   * custom categories added at runtime.
   *
   * Callers should JSON.parse() the result — kept as a string here to
   * mirror getComponentJson's convention.
   */
  listCategories(): string {
    this.assertInitialized();
    return this.engineWorld!.list_categories();
  }
  /**
   * Returns all registered entity contexts as JSON, for populating
   * the Inspector's context multi-select. Includes built-ins and any
   * custom contexts added at runtime.
   */
  listContexts(): string {
    this.assertInitialized();
    return this.engineWorld!.list_contexts();
  }
}
