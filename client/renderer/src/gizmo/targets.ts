/**
 * Which selected entities the transform gizmo moves.
 *
 * Eligibility comes from the engine, not from anything drawn: an entity with
 * no Mesh (a Camera, an empty) is as movable as one with a Mesh, and whether
 * it is visible is the ECS's `EntityInfo.visible`, not a view flag (ADR-038).
 *
 * No Three.js dependency, so it is unit-tested on its own.
 */

/** The slice of ParentMap that target resolution reads. */
export interface TargetHierarchy {
  /** True if the entity existed at the last read. */
  has(handle: number): boolean;
  /** Parent handle, or null for a root or an unknown entity. */
  parentOf(handle: number): number | null;
}

/**
 * The selected entities the gizmo moves: alive, visible, and with no
 * selected (eligible) ancestor, so an entity follows its ancestor instead of
 * moving twice. Selection order is kept. `isVisible` is the engine's answer
 * and is asked only about selected entities; undefined (unknown) is not
 * visible.
 */
export function resolveGizmoTargets(
  handles: readonly number[],
  hierarchy: TargetHierarchy,
  isVisible: (handle: number) => boolean | undefined,
): number[] {
  const eligible = handles.filter(
    (handle) => hierarchy.has(handle) && isVisible(handle) === true,
  );
  const eligibleSet = new Set(eligible);
  return eligible.filter(
    (handle) => !hasAncestorIn(handle, eligibleSet, hierarchy),
  );
}

function hasAncestorIn(
  handle: number,
  set: ReadonlySet<number>,
  hierarchy: TargetHierarchy,
): boolean {
  let parent = hierarchy.parentOf(handle);
  while (parent !== null) {
    if (set.has(parent)) return true;
    parent = hierarchy.parentOf(parent);
  }
  return false;
}
