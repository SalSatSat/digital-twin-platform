import * as THREE from "three/webgpu";
import { GRID_CONFIG } from "./grid-config";
import { createGridMaterialWebGL } from "./grid-material-webgl";
import { createGridMaterialWebGPU } from "./grid-material-webgpu";

/**
 * Creates the Editor-context infinite reference grid mesh.
 *
 * A large, fixed-size plane on the Y=0 world plane, shaded by a
 * procedural grid shader (GLSL for the WebGL backend, TSL for the
 * WebGPU backend — the two render pipelines are not material-
 * compatible with each other).
 * The plane itself is finite (GRID_CONFIG.planeSize) but the shader
 * fades lines out well before the edge, so the edge is never visible
 * — see updateGridPosition() for how it stays centered under the
 * camera.
 *
 * @param isWebGPU Which backend is active — must match the Renderer's
 *   own backend choice, since the two materials are not interchangeable.
 */
export function createGridMesh(isWebGPU: boolean): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    GRID_CONFIG.planeSize,
    GRID_CONFIG.planeSize,
  );
  // PlaneGeometry is built in the XY plane by default; rotate it flat
  // onto XZ (facing +Y) to lie on the ground plane.
  geometry.rotateX(-Math.PI / 2);

  const material = isWebGPU
    ? createGridMaterialWebGPU()
    : createGridMaterialWebGL();

  const mesh = new THREE.Mesh(geometry, material as THREE.Material);
  mesh.name = "EditorReferenceGrid";
  // Purely a visual aid, not part of the ECS scene — never a raycast
  // target (relevant once click-to-select lands).
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Snaps the grid's XZ position under the camera each frame, so the
 * (finite) plane always appears to extend infinitely regardless of
 * camera position. Snapped to the major line interval — rather than
 * updated continuously — so the grid lines themselves don't visibly
 * slide as the camera moves.
 */
export function updateGridPosition(
  mesh: THREE.Mesh,
  cameraPosition: THREE.Vector3,
): void {
  const snap = GRID_CONFIG.minorSpacing * GRID_CONFIG.majorInterval;
  mesh.position.x = Math.round(cameraPosition.x / snap) * snap;
  mesh.position.z = Math.round(cameraPosition.z / snap) * snap;

  // Only the WebGL material needs manual per-frame camera-position
  // sync (plain ShaderMaterial has no built-in camera uniform). The
  // WebGPU/TSL material's `cameraPosition` node updates automatically,
  // so this is a no-op on that path (material.uniforms is undefined
  // for a NodeMaterial).
  const material = mesh.material as THREE.ShaderMaterial;
  if (material.uniforms?.uCameraPosition) {
    material.uniforms.uCameraPosition.value.copy(cameraPosition);
  }
}
