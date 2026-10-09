import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPONENT_KIND_ID,
  EVENT_KIND,
  EventDispatcher,
  NONE,
  decodeEvents,
  drainAndDispatch,
  type EngineEvent,
} from "./events";

/** Builds a drained Uint32Array from four-word records. */
const words = (...records: number[][]): Uint32Array =>
  Uint32Array.from(records.flat());

const spawned = (handle: number): EngineEvent => ({
  kind: "entitySpawned",
  handle,
});

describe("wire constants", () => {
  it("mirror the Rust values", () => {
    // Pinned on the Rust side too (events::tests::event_kind_values_are_stable
    // and tests::component_kind_ids_are_stable). Change both together.
    expect(NONE).toBe(4294967295);
    expect(EVENT_KIND).toEqual({
      EntitySpawned: 0,
      EntityDespawned: 1,
      EntityReparented: 2,
      ComponentChanged: 3,
      Resync: 4,
    });
    expect(COMPONENT_KIND_ID).toEqual({
      LocalTransform: 0,
      Camera: 1,
      Velocity: 2,
      EntityInfo: 3,
    });
  });
});

describe("decodeEvents", () => {
  it("returns nothing for an empty drain", () => {
    expect(decodeEvents(new Uint32Array(0))).toEqual([]);
  });

  it("decodes EntitySpawned", () => {
    expect(
      decodeEvents(words([EVENT_KIND.EntitySpawned, 5, NONE, NONE])),
    ).toEqual([{ kind: "entitySpawned", handle: 5 }]);
  });

  it("decodes EntityDespawned", () => {
    expect(
      decodeEvents(words([EVENT_KIND.EntityDespawned, 5, NONE, NONE])),
    ).toEqual([{ kind: "entityDespawned", handle: 5 }]);
  });

  it("decodes EntityReparented, mapping NONE to null", () => {
    expect(
      decodeEvents(words([EVENT_KIND.EntityReparented, 1, NONE, 0])),
    ).toEqual([
      { kind: "entityReparented", handle: 1, oldParent: null, newParent: 0 },
    ]);
    expect(
      decodeEvents(words([EVENT_KIND.EntityReparented, 1, 0, NONE])),
    ).toEqual([
      { kind: "entityReparented", handle: 1, oldParent: 0, newParent: null },
    ]);
  });

  it.each([
    [0, "LocalTransform"],
    [1, "Camera"],
    [2, "Velocity"],
    [3, "EntityInfo"],
  ])("decodes ComponentChanged with component id %i as %s", (id, name) => {
    expect(
      decodeEvents(words([EVENT_KIND.ComponentChanged, 7, id, NONE])),
    ).toEqual([{ kind: "componentChanged", handle: 7, component: name }]);
  });

  it("decodes Resync", () => {
    expect(decodeEvents(words([EVENT_KIND.Resync, NONE, NONE, NONE]))).toEqual([
      { kind: "resync" },
    ]);
  });

  it("preserves record order within a batch", () => {
    expect(
      decodeEvents(
        words(
          [EVENT_KIND.EntitySpawned, 1, NONE, NONE],
          [EVENT_KIND.EntityDespawned, 1, NONE, NONE],
          [EVENT_KIND.EntitySpawned, 1, NONE, NONE],
        ),
      ),
    ).toEqual([
      { kind: "entitySpawned", handle: 1 },
      { kind: "entityDespawned", handle: 1 },
      { kind: "entitySpawned", handle: 1 },
    ]);
  });

  it("treats an unknown event kind as a resync", () => {
    expect(decodeEvents(words([99, 1, NONE, NONE]))).toEqual([
      { kind: "resync" },
    ]);
  });

  it("treats an unknown component id as a resync", () => {
    expect(
      decodeEvents(words([EVENT_KIND.ComponentChanged, 1, 99, NONE])),
    ).toEqual([{ kind: "resync" }]);
  });

  it("treats a truncated batch as a resync", () => {
    expect(
      decodeEvents(Uint32Array.from([EVENT_KIND.EntitySpawned, 1, NONE])),
    ).toEqual([{ kind: "resync" }]);
  });
});

describe("EventDispatcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers a batch to a subscriber once, in order", () => {
    const dispatcher = new EventDispatcher();
    const handler = vi.fn();
    dispatcher.subscribe(handler);

    dispatcher.dispatch([spawned(1), spawned(2)]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([spawned(1), spawned(2)]);
  });

  it("does not call subscribers for an empty batch", () => {
    const dispatcher = new EventDispatcher();
    const handler = vi.fn();
    dispatcher.subscribe(handler);

    dispatcher.dispatch([]);

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe, and unsubscribing twice is harmless", () => {
    const dispatcher = new EventDispatcher();
    const handler = vi.fn();
    const unsubscribe = dispatcher.subscribe(handler);
    dispatcher.dispatch([spawned(1)]);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();
    dispatcher.dispatch([spawned(2)]);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls every subscriber in subscription order", () => {
    const dispatcher = new EventDispatcher();
    const order: string[] = [];
    dispatcher.subscribe(() => order.push("a"));
    dispatcher.subscribe(() => order.push("b"));
    dispatcher.subscribe(() => order.push("c"));

    dispatcher.dispatch([spawned(1)]);

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("isolates a throwing handler: others still run and dispatch does not throw", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const dispatcher = new EventDispatcher();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    dispatcher.subscribe(bad);
    dispatcher.subscribe(good);

    expect(() => dispatcher.dispatch([spawned(1)])).not.toThrow();

    expect(good).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });

  it("never calls a handler after it unsubscribes, even mid-dispatch", () => {
    const dispatcher = new EventDispatcher();
    const calls: string[] = [];
    let unsubscribeSecond = () => {};
    dispatcher.subscribe(() => {
      calls.push("first");
      unsubscribeSecond();
    });
    unsubscribeSecond = dispatcher.subscribe(() => {
      calls.push("second");
    });

    dispatcher.dispatch([spawned(1)]);

    expect(calls).toEqual(["first"]);
  });

  it("applies a subscription made mid-dispatch from the next dispatch", () => {
    const dispatcher = new EventDispatcher();
    const late = vi.fn();
    let subscribed = false;
    dispatcher.subscribe(() => {
      if (!subscribed) {
        subscribed = true;
        dispatcher.subscribe(late);
      }
    });

    dispatcher.dispatch([spawned(1)]);
    expect(late).not.toHaveBeenCalled();

    dispatcher.dispatch([spawned(2)]);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("drops every subscriber on clear", () => {
    const dispatcher = new EventDispatcher();
    const handler = vi.fn();
    dispatcher.subscribe(handler);
    dispatcher.dispatch([spawned(1)]);
    expect(handler).toHaveBeenCalledTimes(1);

    dispatcher.clear();
    dispatcher.dispatch([spawned(2)]);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("drainAndDispatch", () => {
  it("decodes the drained words and dispatches them as one batch", () => {
    const dispatcher = new EventDispatcher();
    const handler = vi.fn();
    dispatcher.subscribe(handler);
    const source = {
      drain_events: vi.fn(() =>
        words(
          [EVENT_KIND.EntitySpawned, 1, NONE, NONE],
          [EVENT_KIND.EntityDespawned, 2, NONE, NONE],
        ),
      ),
    };

    drainAndDispatch(source, dispatcher);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([
      { kind: "entitySpawned", handle: 1 },
      { kind: "entityDespawned", handle: 2 },
    ]);
  });

  it("drains the source once per call even when nobody is subscribed", () => {
    const dispatcher = new EventDispatcher();
    const source = { drain_events: vi.fn(() => new Uint32Array(0)) };

    drainAndDispatch(source, dispatcher);
    drainAndDispatch(source, dispatcher);

    expect(source.drain_events).toHaveBeenCalledTimes(2);
  });

  it("calls no subscribers when the drain is empty", () => {
    const dispatcher = new EventDispatcher();
    const handler = vi.fn();
    dispatcher.subscribe(handler);
    const source = { drain_events: vi.fn(() => new Uint32Array(0)) };

    drainAndDispatch(source, dispatcher);

    expect(handler).not.toHaveBeenCalled();
  });
});
