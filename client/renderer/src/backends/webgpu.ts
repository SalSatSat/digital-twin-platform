import * as THREE from "three/webgpu";
import { WebGPURenderer } from "three/webgpu";
import { RenderBackend } from "./backend";

/**
 * WebGPU render backend using Three.js WebGPURenderer.
 *
 * Used when WebGPU is available in the browser.
 * Requires async initialization via initialize() before rendering.
 */
export class WebGPUBackend implements RenderBackend {
  private renderer: WebGPURenderer;
  private isInitialized = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true });
  }

  async initialize(): Promise<void> {
    // WebGPURenderer requires explicit async initialization
    // before any rendering can occur
    await this.renderer.init();
    this.isInitialized = true;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    // WebGPURenderer uses renderAsync internally but exposes
    // a synchronous render() method for compatibility
    if (!this.isInitialized) return;
    this.renderer.render(scene, camera);
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height);
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  dispose(): void {
    if (!this.isInitialized) return;
    this.renderer.dispose();
  }
}
