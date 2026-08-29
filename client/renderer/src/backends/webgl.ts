import * as THREE from "three";
import type { RenderBackend } from "./backend";

/**
 * WebGL render backend using Three.js WebGLRenderer.
 *
 * Used as the fallback when WebGPU is not available in the browser.
 * Initialization is synchronous so initialize() resolves immediately.
 */
export class WebGLBackend implements RenderBackend {
  private renderer: THREE.WebGLRenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  }

  async initialize(): Promise<void> {
    // WebGLRenderer requires no async initialization
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  setSize(width: number, height: number): void {
    // false = don't let Three.js set canvas.style.width/height directly.
    // Without this, Three defaults to sizing the canvas's CSS box to
    // match window.innerWidth/innerHeight exactly — which overflows its
    // actual flex container (the middle viewport panel is narrower than
    // the full window once the Hierarchy/Inspector panels take space).
    this.renderer.setSize(width, height, false);
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
