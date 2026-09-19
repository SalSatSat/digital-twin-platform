import * as THREE from "three/webgpu";

/**
 * The six axis-aligned view presets the camera gizmo can snap to.
 */
export type ViewPreset = "Top" | "Bottom" | "Left" | "Right" | "Front" | "Back";

/**
 * A preset's eye direction (unit vector from the look-at target toward
 * the camera) and the up vector to use when looking from there. Top
 * and Bottom need a different up than the rest — looking straight
 * down/up along world +/-Y makes (0, 1, 0) degenerate as an up hint.
 *
 * Convention: Front = camera on the +Z side, Right = camera on the +X
 * side. This is a judgment call, not a standard every engine agrees
 * on — if it feels backwards once you're clicking through it live,
 * swap the signs below rather than anything else in the gizmo.
 */
interface PresetDefinition {
  direction: THREE.Vector3;
  up: THREE.Vector3;
}

const UP_Y = new THREE.Vector3(0, 1, 0);

export const VIEW_PRESETS: Record<ViewPreset, PresetDefinition> = {
  Top: {
    direction: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, -1),
  },
  Bottom: {
    direction: new THREE.Vector3(0, -1, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  Front: { direction: new THREE.Vector3(0, 0, 1), up: UP_Y },
  Back: { direction: new THREE.Vector3(0, 0, -1), up: UP_Y },
  Left: { direction: new THREE.Vector3(-1, 0, 0), up: UP_Y },
  Right: { direction: new THREE.Vector3(1, 0, 0), up: UP_Y },
};

/**
 * Computes the world-space position and orientation for a camera
 * looking at the world origin from the given preset's side, at the
 * given distance.
 *
 * The origin is the same fixed look-at target CameraControls' Alt-
 * orbit already assumes (its `orbitTarget` field defaults to
 * (0, 0, 0) and nothing currently moves it) — there's no per-scene
 * "focus point" concept yet, so this keeps the gizmo consistent with
 * existing orbit behaviour rather than inventing a second convention.
 * If a real focus-point/orbit-target system gets built later, this is
 * the one place that needs to start reading it instead of hardcoding
 * the origin.
 */
export function computePresetTransform(
  preset: ViewPreset,
  distance: number,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const { direction, up } = VIEW_PRESETS[preset];
  const position = direction.clone().multiplyScalar(distance);

  const lookMatrix = new THREE.Matrix4();
  lookMatrix.lookAt(position, new THREE.Vector3(0, 0, 0), up);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);

  return { position, quaternion };
}

/** Just the orientation half of computePresetTransform — distance-independent. */
export function computePresetQuaternion(preset: ViewPreset): THREE.Quaternion {
  return computePresetTransform(preset, 1).quaternion;
}

// Float-safety only — deliberately NOT a perceptual tolerance. "Iso"
// is meant to trigger on any real rotation away from an axis-aligned
// view, however small; this epsilon exists purely to absorb
// floating-point noise from a value's round-trip through the ECS
// (positions/quaternions are stored as f32 there), not to forgive a
// genuinely off-axis camera.
const EXACT_MATCH_EPSILON = 1e-4;

/**
 * Returns which preset the given orientation exactly matches (within
 * floating-point tolerance — see EXACT_MATCH_EPSILON), or null if it
 * doesn't match any of the six axis-aligned views. Used to decide the
 * gizmo's bottom-center label while in Orthographic mode: the
 * matching preset's name, or "Iso" if null.
 */
export function matchPreset(quaternion: THREE.Quaternion): ViewPreset | null {
  for (const key of Object.keys(VIEW_PRESETS) as ViewPreset[]) {
    const presetQuat = computePresetQuaternion(key);
    // abs(dot) accounts for q and -q representing the same rotation.
    const alignment = Math.abs(quaternion.dot(presetQuat));
    if (Math.abs(alignment - 1) < EXACT_MATCH_EPSILON) {
      return key;
    }
  }
  return null;
}
