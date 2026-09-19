import * as THREE from "three/webgpu";

/**
 * Ease with zero velocity at both ends — a camera snap starts and
 * stops smoothly rather than cutting in/out at constant speed.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Interpolates a camera's position and quaternion from a start to a
 * target transform over a fixed duration.
 *
 * Deliberately owns no reference to any Three.js camera, the Engine,
 * or the ECS — it's pure math. SceneManager (which already owns the
 * camera being controlled and the ECS write-back path) drives it:
 * call step() once per frame, apply the returned transform to the
 * Three.js camera, and write it back to the ECS the same way
 * CameraControls does. This keeps the tween itself reusable for
 * anything that needs a smooth camera move later, not just the view
 * gizmo.
 */
export class CameraTween {
  private elapsed = 0;
  private readonly startPosition: THREE.Vector3;
  private readonly startQuaternion: THREE.Quaternion;
  private readonly targetPosition: THREE.Vector3;
  private readonly targetQuaternion: THREE.Quaternion;
  private readonly duration: number;

  constructor(
    startPosition: THREE.Vector3,
    startQuaternion: THREE.Quaternion,
    targetPosition: THREE.Vector3,
    targetQuaternion: THREE.Quaternion,
    duration = 0.35,
  ) {
    this.startPosition = startPosition.clone();
    this.startQuaternion = startQuaternion.clone();
    this.targetPosition = targetPosition.clone();
    this.targetQuaternion = targetQuaternion.clone();
    this.duration = duration;
  }

  /**
   * Advances the tween by deltaTime and returns the interpolated
   * transform for this frame. `done` is true once the target has
   * been reached — the caller should stop calling step() (and drop
   * its reference to this instance) once it sees `done`.
   */
  step(deltaTime: number): {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    done: boolean;
  } {
    this.elapsed += deltaTime;
    const t = Math.min(this.elapsed / this.duration, 1);
    const eased = easeInOutCubic(t);

    const position = this.startPosition
      .clone()
      .lerp(this.targetPosition, eased);
    const quaternion = this.startQuaternion
      .clone()
      .slerp(this.targetQuaternion, eased);

    return { position, quaternion, done: t >= 1 };
  }
}
