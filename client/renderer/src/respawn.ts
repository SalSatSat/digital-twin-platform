/**
 * Boundary respawn, done in place.
 *
 * A dynamic entity that crosses the boundary is put back on the spawn line
 * and given its starting velocity; it is NOT despawned and recreated. That
 * keeps its handle, its EntityInfo id and, above all, its children (a
 * despawn cascades down the hierarchy, ADR-024 addendum, which used to
 * destroy a child and leave its mesh behind in the viewport).
 *
 * No Three.js dependency, so it is unit-tested on its own.
 */

/** The slice of Engine that respawning needs. Engine satisfies it. */
export interface RespawnEngine {
  getPosition(handle: number): Float32Array | undefined;
  getRotation(handle: number): Float32Array | undefined;
  setWorldTransform(
    handle: number,
    position: readonly [number, number, number],
    rotation: readonly [number, number, number, number],
  ): void;
  setComponentJson(handle: number, kind: string, json: string): void;
}

/** Velocity a respawned entity starts with (what despawn+spawn used to give). */
export const RESPAWN_VELOCITY: readonly [number, number, number] = [1, 0, 0];

/**
 * Moves the entity to (spawnX, its current y, 0), keeping its rotation, and
 * resets its velocity to RESPAWN_VELOCITY. Returns true if it respawned; if
 * the entity no longer exists, writes nothing and returns false.
 *
 * Only call this for entities that have a Velocity component: the velocity
 * write throws ReflectionError otherwise.
 */
export function respawnInPlace(
  engine: RespawnEngine,
  handle: number,
  spawnX: number,
): boolean {
  const position = engine.getPosition(handle);
  const rotation = engine.getRotation(handle);
  if (position === undefined || rotation === undefined) {
    return false;
  }
  engine.setWorldTransform(
    handle,
    [spawnX, position[1], 0],
    [rotation[0], rotation[1], rotation[2], rotation[3]],
  );
  engine.setComponentJson(
    handle,
    "Velocity",
    JSON.stringify({ value: RESPAWN_VELOCITY }),
  );
  return true;
}
