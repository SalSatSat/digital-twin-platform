import type { MeshShapeJson } from "./visual";

/**
 * Pure helpers behind the Inspector's Mesh editor (ADR-038). Primitives have
 * no parameters since ADR-039, so the editor only switches variants; the
 * engine owns the variants' names and defaults (component-variants.ts).
 *
 * No Three.js or WASM dependency, so it is unit-tested on its own.
 */

/** The variant's name, such as "Box", or "" for an empty shape. */
export function meshVariantName(shape: MeshShapeJson): string {
  return Object.keys(shape)[0] ?? "";
}
