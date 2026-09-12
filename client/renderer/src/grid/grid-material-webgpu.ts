import { MeshBasicNodeMaterial, DoubleSide } from "three/webgpu";
import {
  Fn,
  vec2,
  vec3,
  float,
  positionWorld,
  cameraPosition,
  distance,
  smoothstep,
  mix,
  max,
  min,
  abs,
  fract,
  clamp,
  fwidth,
} from "three/tsl";
import { GRID_CONFIG } from "./grid-config";

/**
 * TSL equivalent of grid-material-webgl.ts's gridLine() — same
 * fwidth-based antialiased repeating-line technique, expressed as
 * composable nodes instead of raw GLSL. Keep the two in sync if the
 * algorithm changes.
 */
const gridLine = Fn(([coord, spacing, lineWidth]: [any, any, any]) => {
  const scaled = coord.div(spacing);
  const deriv = max(fwidth(scaled).mul(lineWidth), vec2(1e-6, 1e-6));
  const grid = abs(fract(scaled.sub(0.5)).sub(0.5)).div(deriv);
  const line = min(grid.x, grid.y);
  return float(1.0).sub(clamp(line, 0.0, 1.0));
});

/** TSL equivalent of grid-material-webgl.ts's axisLine(). */
const axisLine = Fn(([coord, lineWidth]: [any, any]) => {
  const deriv = max(fwidth(coord).mul(lineWidth), float(1e-6));
  return float(1.0).sub(clamp(abs(coord).div(deriv), 0.0, 1.0));
});

/**
 * TSL node material for the WebGPU backend.
 *
 * Config values are baked in as plain node constants rather than
 * `uniform()` nodes — GRID_CONFIG is fixed for this phase (not
 * user-configurable), and an earlier attempt using uniform() nodes
 * hit a WebGPU-side "Uniform not declared" compile error; baking
 * constants in sidesteps that subsystem entirely. If these values
 * become runtime-configurable later, that's when to revisit.
 *
 * Camera position needs no manual wiring — TSL's built-in
 * `cameraPosition` node tracks the active render camera automatically
 * each frame (unlike the WebGL/ShaderMaterial path, which needs a
 * manually-updated uniform — see grid-mesh.ts's updateGridPosition()).
 */
export function createGridMaterialWebGPU(): MeshBasicNodeMaterial {
  const minorColor = vec3(...GRID_CONFIG.minorColor);
  const majorColor = vec3(...GRID_CONFIG.majorColor);
  const xAxisColor = vec3(...GRID_CONFIG.xAxisColor);
  const zAxisColor = vec3(...GRID_CONFIG.zAxisColor);

  const coord = positionWorld.xz;

  // Minor grid: 1px lines every minorSpacing units. Major grid:
  // heavier lines every 10th minor line (10x10 cell boundaries).
  const minorLine = gridLine(
    coord,
    float(GRID_CONFIG.minorSpacing),
    float(1.0),
  );
  const majorLine = gridLine(
    coord,
    float(GRID_CONFIG.minorSpacing * GRID_CONFIG.majorInterval),
    float(GRID_CONFIG.majorLineWidth),
  );

  let color = mix(minorColor, majorColor, majorLine);
  let lineMask = max(minorLine, majorLine);

  // Origin axis lines, drawn over everything else. X axis is the line
  // where world Z=0 (runs along X) — tested on coord.y since coord =
  // (worldX, worldZ). Z axis is the reverse.
  const xAxisMask = axisLine(coord.y, float(GRID_CONFIG.axisLineWidth));
  const zAxisMask = axisLine(coord.x, float(GRID_CONFIG.axisLineWidth));

  color = mix(color, xAxisColor, xAxisMask);
  color = mix(color, zAxisColor, zAxisMask);
  lineMask = max(lineMask, max(xAxisMask, zAxisMask));

  // Fade out with distance from the camera so the (finite) plane's
  // actual edge is never visible.
  const dist = distance(positionWorld, cameraPosition);
  const fade = float(1.0).sub(
    smoothstep(
      float(GRID_CONFIG.fadeStart),
      float(GRID_CONFIG.fadeDistance),
      dist,
    ),
  );

  const material = new MeshBasicNodeMaterial();
  material.colorNode = color;
  material.opacityNode = lineMask.mul(fade);
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;

  return material;
}
