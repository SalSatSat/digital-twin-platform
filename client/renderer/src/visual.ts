import type { ComponentKindName, EngineEvent } from "./events";

/**
 * Pure logic behind the mesh manager (ADR-038): the wire types for `Mesh` and
 * `Material`, tolerant parsing, colour conversion, and the decisions the
 * manager makes. Nothing here touches Three.js or the engine, so all of it is
 * unit tested; the manager that applies these decisions is in
 * mesh-manager.ts.
 */

/** sRGB red, green and blue, each 0 to 1. */
export type Rgb = [number, number, number];

/**
 * Wire shape of `Mesh`. Mirrors `MeshShape` in
 * engine/core/src/components/mesh.rs. Kept in sync by hand, like the camera
 * types. Primitives have no parameters (ADR-039 decision 10): each variant's
 * body is an empty object, and the entity's scale sizes it.
 */
export type MeshShapeJson =
  | { Box: EmptyShape }
  | { Sphere: EmptyShape }
  | { Cylinder: EmptyShape }
  | { Plane: EmptyShape };

/** The body of a parameter-free primitive: `{}`. */
export type EmptyShape = Record<string, never>;

/** The primitives this renderer can draw, in the engine's variant order. */
const PRIMITIVES = ["Box", "Sphere", "Cylinder", "Plane"] as const;

export interface MeshJson {
  shape: MeshShapeJson;
}

/** Wire shape of `Material`. Mirrors engine/core/src/components/material.rs. */
export interface MaterialJson {
  base_color: Rgb;
}

/** What the manager currently has built for one entity. */
export interface BuiltVisual {
  shape: MeshShapeJson;
  baseColor: Rgb;
}

/** What to do to one entity's visual. */
export type VisualAction =
  | { kind: "none" }
  | { kind: "dispose" }
  | { kind: "create"; shape: MeshShapeJson; baseColor: Rgb }
  | { kind: "update"; shape?: MeshShapeJson; baseColor?: Rgb };

/**
 * Parses `getComponentJson(handle, "Mesh")`. Returns null, and never throws,
 * for an entity without a Mesh or for anything that is not a well-formed
 * Mesh: the manager runs inside the render loop, where a throw stops
 * rendering (ADR-036).
 */
export function parseMesh(json: string | undefined): MeshJson | null {
  const raw = parseJson(json);
  if (!isRecord(raw)) return null;
  const shape = parseShape(raw.shape);
  return shape === null ? null : { shape };
}

/** Parses `getComponentJson(handle, "Material")`; same contract as parseMesh. */
export function parseMaterial(json: string | undefined): MaterialJson | null {
  const raw = parseJson(json);
  if (!isRecord(raw)) return null;
  const baseColor = numberTuple(raw.base_color, 3);
  return baseColor === null ? null : { base_color: baseColor };
}

function parseJson(json: string | undefined): unknown {
  if (json === undefined) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A copy of `value` if it is an array of exactly `length` finite numbers. */
function numberTuple<N extends 2 | 3>(
  value: unknown,
  length: N,
): (N extends 3 ? [number, number, number] : [number, number]) | null {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    !value.every(isFiniteNumber)
  ) {
    return null;
  }
  return [...value] as never;
}

/**
 * Exactly one known primitive with an empty body, or null. A body with
 * fields (a pre-20c size) is refused, as the engine refuses it, rather than
 * drawn at the wrong size.
 */
function parseShape(raw: unknown): MeshShapeJson | null {
  if (!isRecord(raw)) return null;
  const variants = Object.keys(raw);
  if (variants.length !== 1) return null;
  const variant = variants[0];
  const body = raw[variant];
  if (!isRecord(body) || Object.keys(body).length !== 0) return null;
  const primitive = PRIMITIVES.find((name) => name === variant);
  return primitive === undefined
    ? null
    : ({ [primitive]: {} } as MeshShapeJson);
}

/**
 * `#rrggbb` (lowercase) for an sRGB triple. Channels are clamped to 0 to 1
 * and rounded to the nearest of 256 levels; a non-finite channel counts as 0.
 */
export function rgbToHex(rgb: Readonly<Rgb>): string {
  const channels = rgb.map((channel) => {
    const clamped = Number.isFinite(channel)
      ? Math.min(1, Math.max(0, channel))
      : 0;
    return Math.round(clamped * 255)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

/** Parses `#rrggbb` (either case) into an sRGB triple, or null. */
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (match === null) return null;
  return [
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255,
  ];
}

/** An sRGB triple from a `0xrrggbb` literal, for readable scene definitions. */
export function rgbFromInt(rgb: number): Rgb {
  return [
    ((rgb >> 16) & 0xff) / 255,
    ((rgb >> 8) & 0xff) / 255,
    (rgb & 0xff) / 255,
  ];
}

/**
 * Decides what to do to one entity's visual, from the engine's current
 * Mesh and Material and what is built. A Mesh without a Material uses
 * `fallback`; a Material without a Mesh has no effect. An update carries only
 * the parts that changed, so a colour edit never rebuilds geometry.
 */
export function planVisualUpdate(
  mesh: MeshJson | null,
  material: MaterialJson | null,
  fallback: MaterialJson,
  built: BuiltVisual | null,
): VisualAction {
  if (mesh === null) {
    return built === null ? { kind: "none" } : { kind: "dispose" };
  }
  const baseColor = (material ?? fallback).base_color;
  if (built === null) {
    return { kind: "create", shape: mesh.shape, baseColor };
  }
  const shapeChanged =
    shapeSignature(mesh.shape) !== shapeSignature(built.shape);
  const colorChanged = !colorsEqual(baseColor, built.baseColor);
  if (!shapeChanged && !colorChanged) return { kind: "none" };
  return {
    kind: "update",
    ...(shapeChanged ? { shape: mesh.shape } : {}),
    ...(colorChanged ? { baseColor } : {}),
  };
}

/** Primitives have no parameters, so a shape is equal to another by variant. */
function shapeSignature(shape: MeshShapeJson): string {
  return Object.keys(shape)[0] ?? "";
}

function colorsEqual(a: Readonly<Rgb>, b: Readonly<Rgb>): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Which entities' visuals to reconcile after a batch of events (ADR-038
 * decision 7). Events only say that something changed; the manager then reads
 * the engine's current state, so a resync is simply "everything".
 */
export function handlesToReconcile(
  events: readonly EngineEvent[],
): "all" | ReadonlySet<number> {
  const handles = new Set<number>();
  for (const event of events) {
    switch (event.kind) {
      case "resync":
        return "all";
      case "entityDespawned":
        handles.add(event.handle);
        break;
      case "componentAdded":
      case "componentRemoved":
      case "componentChanged":
        if (VISUAL_KINDS.has(event.component)) handles.add(event.handle);
        break;
      default:
        break;
    }
  }
  return handles;
}

const VISUAL_KINDS: ReadonlySet<ComponentKindName> = new Set<ComponentKindName>(
  ["Mesh", "Material"],
);
