import * as THREE from "three";
import { GRID_CONFIG } from "./grid-config";

// World position is computed per-vertex and interpolated, rather than
// reconstructed from screen space, since the grid plane's own local
// space already lies flat on Y=0 — modelMatrix * position gives us
// exact world XZ coordinates to feed the line functions below.
const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

// Standard derivative-based (fwidth) antialiased grid line technique:
// each fragment's distance to the nearest line, measured in screen-
// space derivative units, gives a crisp line at any zoom level or
// viewing angle without supersampling. lineWidth scales that falloff
// distance to make some lines read as visually heavier than others.
const fragmentShader = /* glsl */ `
  varying vec3 vWorldPosition;

  uniform vec3 uCameraPosition;
  uniform float uMinorSpacing;
  uniform float uMajorInterval;
  uniform vec3 uMinorColor;
  uniform vec3 uMajorColor;
  uniform float uMajorLineWidth;
  uniform vec3 uXAxisColor;
  uniform vec3 uZAxisColor;
  uniform float uAxisLineWidth;
  uniform float uFadeStart;
  uniform float uFadeDistance;

  // Antialiased repeating grid line function.
  float gridLine(vec2 coord, float spacing, float lineWidth) {
    vec2 scaled = coord / spacing;
    vec2 derivative = fwidth(scaled) * lineWidth;
    vec2 grid = abs(fract(scaled - 0.5) - 0.5) / max(derivative, vec2(1e-6));
    float line = min(grid.x, grid.y);
    return 1.0 - clamp(line, 0.0, 1.0);
  }

  // Same antialiasing technique as gridLine, but for a single line
  // through coord=0 rather than a repeating grid — used for the
  // origin axis lines.
  float axisLine(float coord, float lineWidth) {
    float derivative = fwidth(coord) * lineWidth;
    return 1.0 - clamp(abs(coord) / max(derivative, 1e-6), 0.0, 1.0);
  }

  void main() {
    vec2 coord = vWorldPosition.xz;

    // Minor grid: 1px lines every uMinorSpacing units.
    float minorLine = gridLine(coord, uMinorSpacing, 1.0);
    // Major grid: heavier lines every 10th minor line (10x10 cell
    // boundaries).
    float majorLine = gridLine(coord, uMinorSpacing * uMajorInterval, uMajorLineWidth);

    vec3 color = mix(uMinorColor, uMajorColor, majorLine);
    float lineMask = max(minorLine, majorLine);

    // Origin axis lines, drawn over everything else. X axis is the
    // line where world Z=0 (runs along X) — tested on coord.y since
    // coord = (worldX, worldZ). Z axis is the reverse.
    float xAxis = axisLine(coord.y, uAxisLineWidth);
    float zAxis = axisLine(coord.x, uAxisLineWidth);

    color = mix(color, uXAxisColor, xAxis);
    color = mix(color, uZAxisColor, zAxis);
    lineMask = max(lineMask, max(xAxis, zAxis));

    // Fade out with distance from the camera so the (finite) plane's
    // actual edge is never visible.
    float dist = distance(vWorldPosition, uCameraPosition);
    float fade = 1.0 - smoothstep(uFadeStart, uFadeDistance, dist);

    float alpha = lineMask * fade;
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * GLSL grid material for the WebGL backend (classic THREE.WebGLRenderer).
 * See grid-material-webgpu.ts for the TSL equivalent used on WebGPU —
 * keep the line-drawing math in sync between the two if it changes.
 */
export function createGridMaterialWebGL(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      // Updated every frame by updateGridPosition() in grid-mesh.ts —
      // plain ShaderMaterial has no built-in camera-position uniform.
      uCameraPosition: { value: new THREE.Vector3() },
      uMinorSpacing: { value: GRID_CONFIG.minorSpacing },
      uMajorInterval: { value: GRID_CONFIG.majorInterval },
      uMinorColor: { value: new THREE.Vector3(...GRID_CONFIG.minorColor) },
      uMajorColor: { value: new THREE.Vector3(...GRID_CONFIG.majorColor) },
      uMajorLineWidth: { value: GRID_CONFIG.majorLineWidth },
      uXAxisColor: { value: new THREE.Vector3(...GRID_CONFIG.xAxisColor) },
      uZAxisColor: { value: new THREE.Vector3(...GRID_CONFIG.zAxisColor) },
      uAxisLineWidth: { value: GRID_CONFIG.axisLineWidth },
      uFadeStart: { value: GRID_CONFIG.fadeStart },
      uFadeDistance: { value: GRID_CONFIG.fadeDistance },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
