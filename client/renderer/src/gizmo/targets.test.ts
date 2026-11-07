import { describe, expect, it } from "vitest";
import { resolveGizmoTargets, type TargetHierarchy } from "./targets";

/** A hierarchy from a child -> parent table. Entities not listed do not exist. */
function hierarchyOf(parents: Record<number, number | null>): TargetHierarchy {
  return {
    has: (handle) => handle in parents,
    parentOf: (handle) => parents[handle] ?? null,
  };
}

/** The engine's answer: true for everyone except the hidden and unknown. */
function visibility(hidden: number[] = [], unknown: number[] = []) {
  return (handle: number): boolean | undefined => {
    if (unknown.includes(handle)) return undefined;
    return !hidden.includes(handle);
  };
}

const ROOTS = { 1: null, 2: null, 3: null };

describe("resolveGizmoTargets", () => {
  it("keeps the selected entities that exist and are visible, in order", () => {
    expect(
      resolveGizmoTargets([3, 1, 2], hierarchyOf(ROOTS), visibility()),
    ).toEqual([3, 1, 2]);
  });

  it("returns nothing for an empty selection", () => {
    expect(resolveGizmoTargets([], hierarchyOf(ROOTS), visibility())).toEqual(
      [],
    );
  });

  it("skips a hidden entity", () => {
    expect(
      resolveGizmoTargets([1, 2], hierarchyOf(ROOTS), visibility([2])),
    ).toEqual([1]);
  });

  it("skips an entity whose visibility the engine does not know", () => {
    expect(
      resolveGizmoTargets([1, 2], hierarchyOf(ROOTS), visibility([], [1])),
    ).toEqual([2]);
  });

  it("skips an entity that no longer exists, whatever visibility says", () => {
    expect(
      resolveGizmoTargets([1, 99], hierarchyOf(ROOTS), visibility()),
    ).toEqual([1]);
  });

  it("asks the engine about visibility only for the selected entities", () => {
    const asked: number[] = [];

    resolveGizmoTargets([1, 2], hierarchyOf(ROOTS), (handle) => {
      asked.push(handle);
      return true;
    });

    expect(asked).toEqual([1, 2]);
  });

  it("drops a selected entity whose parent is also selected", () => {
    const hierarchy = hierarchyOf({ 1: null, 2: 1 });

    expect(resolveGizmoTargets([1, 2], hierarchy, visibility())).toEqual([1]);
  });

  it("drops a selected entity with a selected grandparent", () => {
    const hierarchy = hierarchyOf({ 1: null, 2: 1, 3: 2 });

    expect(resolveGizmoTargets([1, 3], hierarchy, visibility())).toEqual([1]);
  });

  it("keeps a selected descendant when its selected ancestor is hidden", () => {
    const hierarchy = hierarchyOf({ 1: null, 2: 1 });

    expect(resolveGizmoTargets([1, 2], hierarchy, visibility([1]))).toEqual([
      2,
    ]);
  });

  it("keeps siblings that share a parent that is not selected", () => {
    const hierarchy = hierarchyOf({ 1: null, 2: 1, 3: 1 });

    expect(resolveGizmoTargets([2, 3], hierarchy, visibility())).toEqual([
      2, 3,
    ]);
  });

  it("does not modify the selection it is given", () => {
    const selection = [2, 1];

    resolveGizmoTargets(
      selection,
      hierarchyOf({ 1: null, 2: 1 }),
      visibility(),
    );

    expect(selection).toEqual([2, 1]);
  });
});
