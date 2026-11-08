/**
 * Inspector logic for adding and removing optional components (ADR-037).
 *
 * No Three.js or WASM dependency, so it is unit-tested on its own; the React
 * components in client/app only wire it to buttons.
 */
import { ReflectionError } from "./reflection-error";

/** One reflectable component kind, as the engine's registry lists it. */
export interface ComponentKindInfo {
  kind: string;
  displayName: string;
  /** True if the kind can be added and removed after spawn. */
  optional: boolean;
}

/** The slice of Engine that adding and removing components needs. */
export interface ComponentEditEngine {
  defaultComponentJson(kind: string): string | undefined;
  addComponentJson(handle: number, kind: string, json: string): void;
  removeComponent(handle: number, kind: string): void;
}

function malformed(problem: string): Error {
  return new Error(
    `Malformed component kind list: ${problem}. A stale WASM binding looks ` +
      "like this; rebuild the WASM package.",
  );
}

/**
 * Parses the registry listing from Engine.listComponentKinds(), keeping the
 * registry order. Strict on purpose: a missing field means the editor and the
 * WASM package disagree about the wire format, and a loud error beats an
 * Inspector that silently lacks its Add button.
 */
export function parseComponentKinds(json: string): ComponentKindInfo[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw malformed("expected an array");
  }
  return parsed.map((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw malformed(`entry ${index} is not an object`);
    }
    const fields = entry as Record<string, unknown>;
    if (typeof fields.kind !== "string") {
      throw malformed(`entry ${index} has no kind`);
    }
    if (typeof fields.display_name !== "string") {
      throw malformed(`entry ${index} has no display_name`);
    }
    if (typeof fields.optional !== "boolean") {
      throw malformed(`entry ${index} has no boolean optional flag`);
    }
    return {
      kind: fields.kind,
      displayName: fields.display_name,
      optional: fields.optional,
    };
  });
}

/**
 * The kinds the Inspector may offer to add to an entity: optional kinds it
 * does not have yet, in registry order. A mandatory kind is never offered,
 * even if the entity lacks it.
 */
export function addableKinds(
  kinds: readonly ComponentKindInfo[],
  present: readonly string[],
): ComponentKindInfo[] {
  return kinds.filter((k) => k.optional && !present.includes(k.kind));
}

/** Runs an engine write; a rejection becomes its message, a bug propagates. */
function rejectionMessage(write: () => void): string | null {
  try {
    write();
    return null;
  } catch (e) {
    if (e instanceof ReflectionError) {
      return e.message;
    }
    throw e;
  }
}

/**
 * Adds a component of `kind` with the engine's default value. Returns null on
 * success, or a message meant to be shown to the user: the engine's reason if
 * it rejected the add, or "<kind> cannot be added" if the engine has no
 * default for the kind. Anything that is not a ReflectionError is rethrown.
 */
export function addDefaultComponent(
  engine: ComponentEditEngine,
  handle: number,
  kind: string,
): string | null {
  const json = engine.defaultComponentJson(kind);
  if (json === undefined) {
    return `${kind} cannot be added`;
  }
  return rejectionMessage(() => engine.addComponentJson(handle, kind, json));
}

/**
 * Removes the component of `kind`. Returns null on success, or the engine's
 * reason for rejecting it. Anything that is not a ReflectionError is
 * rethrown.
 */
export function removeOptionalComponent(
  engine: ComponentEditEngine,
  handle: number,
  kind: string,
): string | null {
  return rejectionMessage(() => engine.removeComponent(handle, kind));
}
