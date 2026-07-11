import init, { EngineWorld } from "dt-engine-wasm";

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
   * Advances the ECS by one tick.
   * delta_time is elapsed time in seconds since the last tick.
   */
  tick(deltaTime: number): void {
    this.assertInitialized();
    this.engineWorld!.tick(deltaTime);
  }

  /**
   * Returns the position of an entity as [x, y, z].
   * Returns undefined if the handle is invalid or the entity
   * has no Transform component.
   */
  getPosition(handle: number): Float32Array | undefined {
    this.assertInitialized();
    return this.engineWorld!.get_position(handle) ?? undefined;
  }

  /**
   * Returns the total number of entities in the world.
   */
  entityCount(): number {
    this.assertInitialized();
    return this.engineWorld!.entity_count();
  }

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
}
