import * as THREE from "three/webgpu";

/**
 * Write-back callback — called each frame with the camera's
 * current position and rotation so the ECS can be updated.
 */
type WriteBackFn = (
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  rw: number,
) => void;

/**
 * Free Camera controls for the Scene Camera.
 *
 * Supported interactions:
 * - Right mouse + drag     — look around (rotate)
 * - Right mouse + WASD     — fly through the scene
 * - Middle mouse + drag    — pan
 * - Scroll wheel           — zoom (dolly forward/back)
 * - Alt + left mouse drag  — orbit around target point
 *
 * Controls operate on a Three.js PerspectiveCamera and write
 * the resulting transform back to the ECS via a callback.
 */
export class CameraControls {
  private camera: THREE.PerspectiveCamera | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private writeBack: WriteBackFn | null = null;

  // Mouse state
  private isRightMouseDown = false;
  private isMiddleMouseDown = false;
  private isAltLeftMouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Keyboard state
  private keys: Set<string> = new Set();

  // Orbit state
  private orbitTarget = new THREE.Vector3(0, 0, 0);

  // Settings
  flySpeed = 5.0;
  lookSensitivity = 0.002;
  panSensitivity = 0.005;
  zoomSpeed = 0.5;
  orbitSensitivity = 0.005;

  // Accumulated movement for smooth fly
  private euler = new THREE.Euler(0, 0, 0, "YXZ");

  // Set whenever user input actually mutates the camera this frame —
  // look, pan, orbit, zoom, or fly movement. writeBack only fires when
  // this is true, so an idle camera stops re-asserting its own
  // transform every frame and racing an Inspector edit to the same
  // camera in between.
  private dirty = false;

  /**
   * Attaches controls to a canvas element and starts listening for input.
   */
  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /**
   * Detaches controls and stops listening for input.
   */
  detach(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas = null;
  }

  /**
   * Sets the camera to control.
   */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    // Initialise euler from camera's current rotation
    this.euler.setFromQuaternion(camera.quaternion, "YXZ");
  }

  /**
   * Sets the write-back callback — called each frame after
   * the camera transform is updated.
   */
  setWriteBack(fn: WriteBackFn): void {
    this.writeBack = fn;
  }

  /**
   * Updates the camera transform based on accumulated input.
   * Call this once per frame from the render loop.
   */
  update(deltaTime: number): void {
    if (!this.camera) return;

    // Fly mode — WASD movement while right mouse is held
    if (this.isRightMouseDown) {
      const speed = this.flySpeed * deltaTime;
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);

      this.camera.getWorldDirection(forward);
      right.crossVectors(forward, up).normalize();

      let moved = false;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) {
        this.camera.position.addScaledVector(forward, speed);
        moved = true;
      }
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) {
        this.camera.position.addScaledVector(forward, -speed);
        moved = true;
      }
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) {
        this.camera.position.addScaledVector(right, -speed);
        moved = true;
      }
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) {
        this.camera.position.addScaledVector(right, speed);
        moved = true;
      }
      if (this.keys.has("KeyE") || this.keys.has("Space")) {
        this.camera.position.addScaledVector(up, speed);
        moved = true;
      }
      if (this.keys.has("KeyQ")) {
        this.camera.position.addScaledVector(up, -speed);
        moved = true;
      }
      if (moved) this.dirty = true;
    }

    // Write back to ECS — only when something actually changed the
    // camera this frame, so an idle camera doesn't keep re-asserting
    // its own transform and racing an Inspector edit to it.
    if (this.writeBack && this.dirty) {
      const p = this.camera.position;
      const q = this.camera.quaternion;
      this.writeBack(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      this.dirty = false;
    }
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && e.altKey) {
      this.isAltLeftMouseDown = true;
    } else if (e.button === 1) {
      this.isMiddleMouseDown = true;
      e.preventDefault();
    } else if (e.button === 2) {
      this.isRightMouseDown = true;
    }
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.isAltLeftMouseDown = false;
    if (e.button === 1) this.isMiddleMouseDown = false;
    if (e.button === 2) this.isRightMouseDown = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.camera) return;

    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (this.isRightMouseDown) {
      // Look around
      this.euler.y -= dx * this.lookSensitivity;
      this.euler.x -= dy * this.lookSensitivity;
      // Clamp vertical look to avoid flipping
      this.euler.x = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, this.euler.x),
      );
      this.camera.quaternion.setFromEuler(this.euler);
      this.dirty = true;
    }

    if (this.isMiddleMouseDown) {
      // Pan
      const right = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      right.crossVectors(forward, up).normalize();

      this.camera.position.addScaledVector(right, -dx * this.panSensitivity);
      this.camera.position.addScaledVector(up, dy * this.panSensitivity);
      this.dirty = true;
    }

    if (this.isAltLeftMouseDown) {
      // Orbit around target
      const offset = new THREE.Vector3().subVectors(
        this.camera.position,
        this.orbitTarget,
      );

      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= dx * this.orbitSensitivity;
      spherical.phi -= dy * this.orbitSensitivity;
      spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi));

      offset.setFromSpherical(spherical);
      this.camera.position.copy(this.orbitTarget).add(offset);
      this.camera.lookAt(this.orbitTarget);
      this.euler.setFromQuaternion(this.camera.quaternion, "YXZ");
      this.dirty = true;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.camera) return;
    e.preventDefault();

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const delta = e.deltaY > 0 ? -this.zoomSpeed : this.zoomSpeed;
    this.camera.position.addScaledVector(forward, delta);
    this.dirty = true;
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
}
