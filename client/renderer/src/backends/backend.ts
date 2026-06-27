import * as THREE from "three";

/**
 * Common interface for render backends.
 *
 * Abstracts the differences between WebGLRenderer and WebGPURenderer
 * so the Renderer class can work with either without knowing which
 * one is active.
 */
export interface RenderBackend {
  /**
   * Performs any async initialization the backend requires.
   * Must be awaited before calling render().
   */
  initialize(): Promise<void>;

  /**
   * Renders the scene from the camera's perspective.
   */
  render(scene: THREE.Scene, camera: THREE.Camera): void;

  /**
   * Updates the backend's output size.
   * Call when the canvas is resized.
   */
  setSize(width: number, height: number): void;

  /**
   * Sets the pixel ratio for the backend.
   */
  setPixelRatio(ratio: number): void;

  /**
   * Releases all backend resources.
   */
  dispose(): void;
}
