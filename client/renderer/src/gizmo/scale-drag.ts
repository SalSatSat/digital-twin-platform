/**
 * Pure rules behind the transform gizmo's scale mode (ADR-039 decision 9).
 *
 * TransformControls scales its proxy in the proxy's local axes, and the
 * proxy's scale is reset to 1 before every drag, so the proxy's scale during
 * a drag is the drag's per-axis factor. Each target then scales about its own
 * origin: its local scale is its drag-start local scale times that factor,
 * axis by axis, so repeated writes during one drag never accumulate.
 *
 * No Three.js dependency, so it is unit-tested on its own.
 */

export type Vec3Tuple = [number, number, number];

/**
 * The entity the scale handles line up with: the primary selection when it is
 * one of the targets, otherwise the first target, otherwise none (world axes).
 * The primary is not a target when it is hidden, or when a selected ancestor
 * moves it instead; lining up with it then would show axes the drag does not
 * scale.
 */
export function orientationSource(
  primary: number | null,
  targets: readonly number[],
): number | null {
  if (primary !== null && targets.includes(primary)) return primary;
  return targets[0] ?? null;
}

/**
 * A target's new local scale: its drag-start local scale times the drag's
 * factor, axis by axis. A negative factor mirrors and is kept. Returns null,
 * meaning skip this frame's write, when any axis would be zero or not finite
 * as the f32 the engine receives: the engine rejects those (ADR-039 decision
 * 2), and TransformControls can produce them (dragging exactly onto the
 * centre, or a degenerate start point).
 */
export function scaledLocal(
  start: Readonly<Vec3Tuple>,
  factor: Readonly<Vec3Tuple>,
): Vec3Tuple | null {
  const scale: Vec3Tuple = [
    start[0] * factor[0],
    start[1] * factor[1],
    start[2] * factor[2],
  ];
  return scale.every(isWritableAxis) ? scale : null;
}

/** Finite and non-zero once narrowed to the f32 the engine stores. */
function isWritableAxis(value: number): boolean {
  const f32 = Math.fround(value);
  return Number.isFinite(f32) && f32 !== 0;
}
