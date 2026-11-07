/**
 * Inspector logic for switching a tagged-enum component between its
 * variants (ADR-038), such as a Mesh between Box and Sphere.
 *
 * No Three.js or WASM dependency, so it is unit-tested on its own. The
 * variant names and their defaults come from the engine; the client keeps no
 * copy of them.
 */

import { rejectionMessage } from "./component-edit";

/** One variant of a component, as the engine lists it. */
export interface ComponentVariantInfo {
  /** The variant's name on the wire, for example "Sphere". */
  name: string;
  /**
   * The complete component JSON with this variant at its defaults, ready to
   * pass to `setComponentJson`.
   */
  defaultJson: string;
}

/** The slice of Engine that switching a variant needs. */
export interface ComponentVariantsEngine {
  componentVariantsJson(kind: string): string | undefined;
  setComponentJson(handle: number, kind: string, json: string): void;
}

/**
 * Parses the engine's variant listing for one kind. Strict on purpose, like
 * parseComponentKinds: a missing field means the editor and the WASM package
 * disagree about the wire format, and a loud error beats a dropdown that
 * silently lacks entries.
 */
export function parseComponentVariants(json: string): ComponentVariantInfo[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw malformed("expected an array");
  }
  return parsed.map((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw malformed(`entry ${index} is not an object`);
    }
    const fields = entry as Record<string, unknown>;
    if (typeof fields.name !== "string") {
      throw malformed(`entry ${index} has no name`);
    }
    const value = fields.default;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw malformed(`entry ${index} has no default component object`);
    }
    return { name: fields.name, defaultJson: JSON.stringify(value) };
  });
}

function malformed(problem: string): Error {
  return new Error(
    `Malformed component variant list: ${problem}. A stale WASM binding ` +
      "looks like this; rebuild the WASM package.",
  );
}

/**
 * The variants of `kind`, in the engine's display order. Empty when the kind
 * has none.
 */
export function componentVariants(
  engine: Pick<ComponentVariantsEngine, "componentVariantsJson">,
  kind: string,
): ComponentVariantInfo[] {
  const json = engine.componentVariantsJson(kind);
  return json === undefined ? [] : parseComponentVariants(json);
}

/**
 * Replaces the component of `kind` on `handle` with the named variant at its
 * defaults. Returns null on success, or a message meant to be shown to the
 * user: the engine's reason if it rejected the write, or "<kind> has no
 * variant <name>" if the engine does not list that variant. Anything that is
 * not a ReflectionError is rethrown.
 */
export function switchVariant(
  engine: ComponentVariantsEngine,
  handle: number,
  kind: string,
  variant: string,
): string | null {
  const found = componentVariants(engine, kind).find(
    (candidate) => candidate.name === variant,
  );
  if (found === undefined) {
    return `${kind} has no variant ${variant}`;
  }
  return rejectionMessage(() =>
    engine.setComponentJson(handle, kind, found.defaultJson),
  );
}
