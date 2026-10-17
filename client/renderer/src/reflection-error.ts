/**
 * Thrown when a component write is rejected: setComponentJson,
 * addComponentJson or removeComponent. The reason can be a bad JSON shape, a
 * semantic validation failure (e.g. "near must be less than far", an
 * unregistered category), or a structural one (e.g. "component already
 * present on entity"). The message is meant to be shown to the user directly
 * in the Inspector, not just logged.
 *
 * Lives in its own file, not in engine.ts, so modules that need to recognise
 * it do not pull in the WASM glue (and stay unit-testable).
 */
export class ReflectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReflectionError";
  }
}
