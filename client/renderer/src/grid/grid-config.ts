/**
 * Shared configuration for the Editor-context infinite reference grid
 * (Phase 15). Fixed constants for now — not user-configurable. Revisit
 * if/when a broader editor-settings/theme system is introduced.
 */
export const GRID_CONFIG = {
  /** World-space size of the underlying plane, in units. Must stay
   *  comfortably larger than 2 * fadeDistance so the plane's actual
   *  edge is never visible — it should always fade out first. */
  planeSize: 1200,

  /** Spacing between minor grid lines, in world units. */
  minorSpacing: 1.0,

  /** Number of minor lines between (and including) each major line —
   *  i.e. major lines mark the boundary of each 10x10 minor cell block. */
  majorInterval: 10,

  /** Minor line color (RGB, 0-1). */
  minorColor: [0.35, 0.35, 0.35] as [number, number, number],

  /** Major line color — brighter than minor, marks each 10x10 cell
   *  boundary. Paired with majorLineWidth below for extra emphasis. */
  majorColor: [0.75, 0.75, 0.75] as [number, number, number],

  /** Line-width multiplier for major lines (minor lines always use
   *  1.0, i.e. a crisp ~1px line regardless of zoom/angle). */
  majorLineWidth: 2.0,

  /** Origin axis colors — Unity/Blender convention: X red, Z blue.
   *  These are the most visually prominent lines on the grid. */
  xAxisColor: [0.9, 0.25, 0.25] as [number, number, number],
  zAxisColor: [0.25, 0.45, 0.95] as [number, number, number],

  /** Axis line width multiplier — thicker than major lines. */
  axisLineWidth: 2.5,

  /** Distance from camera at which fade begins (full opacity inside
   *  this radius). Tuned against the scene's camera far plane (1000),
   *  not just the grid's own scale — see Phase 15 fade-distance
   *  discussion. */
  fadeStart: 250.0,

  /** Distance from camera at which the grid is fully faded out. */
  fadeDistance: 500.0,
} as const;
