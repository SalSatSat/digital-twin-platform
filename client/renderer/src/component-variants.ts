/**
 * The variants of a tagged-enum component, such as a Mesh's Box and Sphere
 * (ADR-038), as the engine lists them.
 *
 * No Three.js or WASM dependency, so it is unit-tested on its own. The
 * variant names and their defaults come from the engine; the client keeps no
 * copy of them. The Inspector switches variant by passing the chosen
 * variant's default through useComponentField's debounced `setValue`, the
 * same path as every other edit, so a pending edit can never overwrite it.
 */

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

/** The slice of Engine that listing variants needs. */
export interface ComponentVariantsEngine {
  componentVariantsJson(kind: string): string | undefined;
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
  engine: ComponentVariantsEngine,
  kind: string,
): ComponentVariantInfo[] {
  const json = engine.componentVariantsJson(kind);
  return json === undefined ? [] : parseComponentVariants(json);
}
