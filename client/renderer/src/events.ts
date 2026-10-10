/**
 * Engine change events on the client (ADR-036).
 *
 * The engine records API-driven entity changes in a queue; `Engine.tick`
 * drains it once per frame as a flat Uint32Array of four-word records
 * `[kind, handle, a, b]`. `decodeEvents` turns that into typed events and
 * `EventDispatcher` hands each frame's ordered batch to subscribers
 * (Unity's `ObjectChangeEvents.changesPublished` is the model).
 *
 * Events carry ids only. Consumers re-read state through the Engine getters,
 * and must not read state for a handle after `entityDespawned` until an
 * `entitySpawned` for it arrives (handle slots are reused).
 *
 * This file has no WASM dependency, so it is unit-tested on its own.
 * Written to satisfy the app's `erasableSyntaxOnly`: no enums, no
 * constructor parameter properties.
 */

/** "No value" in a record word. Mirrors `events::NONE` in Rust. */
export const NONE = 0xffffffff;

/** Record kinds. Mirror engine/wasm/src/events.rs. */
export const EVENT_KIND = {
  EntitySpawned: 0,
  EntityDespawned: 1,
  EntityReparented: 2,
  ComponentChanged: 3,
  Resync: 4,
} as const;

/** Component ids. Mirror `ComponentKind::id` in engine/wasm/src/reflection.rs. */
export const COMPONENT_KIND_ID = {
  LocalTransform: 0,
  Camera: 1,
  Velocity: 2,
  EntityInfo: 3,
} as const;

export type ComponentKindName = keyof typeof COMPONENT_KIND_ID;

export type EngineEvent =
  | { kind: "entitySpawned"; handle: number }
  | { kind: "entityDespawned"; handle: number }
  | {
      kind: "entityReparented";
      handle: number;
      oldParent: number | null;
      newParent: number | null;
    }
  | { kind: "componentChanged"; handle: number; component: ComponentKindName }
  /** Consumers must discard cached state and refetch snapshots. */
  | { kind: "resync" };

/** Called at most once per dispatch with that frame's ordered events. */
export type EventBatchHandler = (events: readonly EngineEvent[]) => void;

const RECORD_WORDS = 4;

const COMPONENT_NAME_BY_ID: ReadonlyMap<number, ComponentKindName> = new Map(
  (Object.entries(COMPONENT_KIND_ID) as [ComponentKindName, number][]).map(
    ([name, id]) => [id, name],
  ),
);

function parentOrNull(word: number): number | null {
  return word === NONE ? null : word;
}

/**
 * Decodes a drained Uint32Array of `[kind, handle, a, b]` records.
 *
 * Anything this client cannot trust becomes a `resync`, so consumers
 * refetch instead of acting on a misread stream: an unknown event kind or
 * component id (version skew between engine and client), or a length that
 * is not a whole number of records.
 */
export function decodeEvents(words: Uint32Array): EngineEvent[] {
  if (words.length % RECORD_WORDS !== 0) {
    return [{ kind: "resync" }];
  }
  const events: EngineEvent[] = [];
  for (let i = 0; i < words.length; i += RECORD_WORDS) {
    const kind = words[i];
    const handle = words[i + 1];
    const a = words[i + 2];
    const b = words[i + 3];
    switch (kind) {
      case EVENT_KIND.EntitySpawned:
        events.push({ kind: "entitySpawned", handle });
        break;
      case EVENT_KIND.EntityDespawned:
        events.push({ kind: "entityDespawned", handle });
        break;
      case EVENT_KIND.EntityReparented:
        events.push({
          kind: "entityReparented",
          handle,
          oldParent: parentOrNull(a),
          newParent: parentOrNull(b),
        });
        break;
      case EVENT_KIND.ComponentChanged: {
        const component = COMPONENT_NAME_BY_ID.get(a);
        events.push(
          component === undefined
            ? { kind: "resync" }
            : { kind: "componentChanged", handle, component },
        );
        break;
      }
      default:
        // EVENT_KIND.Resync, or a kind this client does not know: either
        // way cached state cannot be trusted.
        events.push({ kind: "resync" });
    }
  }
  return events;
}

/**
 * Fans each frame's ordered batch out to subscribers.
 *
 * - A subscriber is called at most once per dispatch, and never for an
 *   empty batch.
 * - A throwing handler is logged and skipped. `Engine.tick` runs inside the
 *   render loop's try/catch, which stops rendering on any throw, so a UI bug
 *   in a handler must not escape (ADR-036 decision 6).
 * - After `unsubscribe` returns, the handler is never called again, even
 *   mid-dispatch. A subscription made mid-dispatch starts with the next one.
 */
export class EventDispatcher {
  // Wrapper objects, so the same function subscribed twice stays two
  // independent subscriptions.
  private readonly subscriptions = new Set<{ handler: EventBatchHandler }>();

  subscribe(handler: EventBatchHandler): () => void {
    const subscription = { handler };
    this.subscriptions.add(subscription);
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  dispatch(events: readonly EngineEvent[]): void {
    if (events.length === 0) {
      return;
    }
    // Iterate a snapshot so subscribe/unsubscribe during a handler cannot
    // disturb this pass.
    for (const subscription of [...this.subscriptions]) {
      if (!this.subscriptions.has(subscription)) {
        continue; // unsubscribed by an earlier handler in this dispatch
      }
      try {
        subscription.handler(events);
      } catch (error) {
        console.error("EventDispatcher: handler threw", error);
      }
    }
  }

  clear(): void {
    this.subscriptions.clear();
  }
}

/** Anything that can hand over a drained batch: the WASM `EngineWorld`. */
export interface EventSource {
  drain_events(): Uint32Array;
}

/**
 * Drains the source exactly once per call, even when nobody is subscribed
 * (so the engine's queue never grows), decodes the words, and dispatches
 * them as one batch.
 */
export function drainAndDispatch(
  source: EventSource,
  dispatcher: EventDispatcher,
): void {
  dispatcher.dispatch(decodeEvents(source.drain_events()));
}

function isStructural(event: EngineEvent): boolean {
  return (
    event.kind === "entitySpawned" ||
    event.kind === "entityDespawned" ||
    event.kind === "entityReparented" ||
    event.kind === "resync"
  );
}

/**
 * True if the batch can change who exists or who is whose parent: a spawn,
 * a despawn, a reparent, or a resync. This is all the transform gizmo needs
 * to know to refresh its ancestor map.
 */
export function affectsHierarchy(events: readonly EngineEvent[]): boolean {
  return events.some(isStructural);
}

/**
 * True if the batch can change what the Hierarchy panel lists: anything
 * that affects the hierarchy, or a change to an entity's EntityInfo (its
 * name and contexts).
 */
export function affectsEntityListing(events: readonly EngineEvent[]): boolean {
  return events.some(
    (event) =>
      isStructural(event) ||
      (event.kind === "componentChanged" && event.component === "EntityInfo"),
  );
}

/**
 * True if the batch can change which components the entity behind `handle`
 * has, or what any of them holds: a resync, or a spawn or despawn of that
 * handle (slots are reused, so a despawn and a spawn of the same handle can
 * arrive in one batch).
 */
export function affectsEntity(
  events: readonly EngineEvent[],
  handle: number,
): boolean {
  return events.some(
    (event) =>
      event.kind === "resync" ||
      ((event.kind === "entitySpawned" || event.kind === "entityDespawned") &&
        event.handle === handle),
  );
}

/**
 * True if the batch can change the value of one component on one entity:
 * anything that affects the entity, or a `componentChanged` for exactly that
 * handle and component. A reparent alone does not count; the `LocalTransform`
 * change that accompanies a world-preserving reparent does.
 */
export function affectsComponent(
  events: readonly EngineEvent[],
  handle: number,
  component: ComponentKindName,
): boolean {
  return (
    affectsEntity(events, handle) ||
    events.some(
      (event) =>
        event.kind === "componentChanged" &&
        event.handle === handle &&
        event.component === component,
    )
  );
}
