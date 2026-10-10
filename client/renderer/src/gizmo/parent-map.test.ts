import { describe, expect, it, vi } from "vitest";
import type { EntityHierarchyNode } from "../engine";
import type { EngineEvent } from "../events";
import { ParentMap } from "./parent-map";

const node = (handle: number, parent: number | null): EntityHierarchyNode => ({
  handle,
  parent_handle: parent,
  name: `entity-${handle}`,
  contexts: [],
});

const spawned: EngineEvent = { kind: "entitySpawned", handle: 9 };
const transformChanged: EngineEvent = {
  kind: "componentChanged",
  handle: 1,
  component: "LocalTransform",
};

describe("ParentMap", () => {
  it("does not read until asked", () => {
    const read = vi.fn(() => [node(1, null)]);

    new ParentMap(read);

    expect(read).not.toHaveBeenCalled();
  });

  it("reads once on the first refresh, because it starts dirty", () => {
    const read = vi.fn(() => [node(1, null)]);
    const parents = new ParentMap(read);

    parents.refreshIfDirty();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not re-read while clean", () => {
    const read = vi.fn(() => [node(1, null)]);
    const parents = new ParentMap(read);

    parents.refreshIfDirty();
    parents.refreshIfDirty();
    parents.refreshIfDirty();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("re-reads exactly once after markDirty", () => {
    const read = vi.fn(() => [node(1, null)]);
    const parents = new ParentMap(read);
    parents.refreshIfDirty();

    parents.markDirty();
    parents.refreshIfDirty();
    parents.refreshIfDirty();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("answers has and parentOf from the last read", () => {
    const parents = new ParentMap(() => [node(1, null), node(2, 1)]);

    parents.refreshIfDirty();

    expect(parents.has(1)).toBe(true);
    expect(parents.has(2)).toBe(true);
    expect(parents.has(3)).toBe(false);
    expect(parents.parentOf(1)).toBeNull();
    expect(parents.parentOf(2)).toBe(1);
    expect(parents.parentOf(3)).toBeNull();
  });

  it("replaces the previous read, so a despawned entity disappears", () => {
    let nodes = [node(1, null), node(2, 1)];
    const parents = new ParentMap(() => nodes);
    parents.refreshIfDirty();

    nodes = [node(1, null)];
    parents.markDirty();
    parents.refreshIfDirty();

    expect(parents.has(2)).toBe(false);
    expect(parents.has(1)).toBe(true);
  });

  it("is marked dirty by a batch that can change the hierarchy", () => {
    const read = vi.fn(() => [node(1, null)]);
    const parents = new ParentMap(read);
    parents.refreshIfDirty();

    parents.observe([spawned]);
    parents.refreshIfDirty();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("is not marked dirty by a batch that cannot change the hierarchy", () => {
    const read = vi.fn(() => [node(1, null)]);
    const parents = new ParentMap(read);
    parents.refreshIfDirty();

    parents.observe([transformChanged]);
    parents.refreshIfDirty();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("is not marked dirty by an empty batch", () => {
    const read = vi.fn(() => [node(1, null)]);
    const parents = new ParentMap(read);
    parents.refreshIfDirty();

    parents.observe([]);
    parents.refreshIfDirty();

    expect(read).toHaveBeenCalledTimes(1);
  });
});
