import type { EntityHierarchyNode } from "../engine";
import { affectsHierarchy, type EngineEvent } from "../events";

/**
 * The gizmo's view of the entity hierarchy: which entities exist and who is
 * whose parent. It is re-read only after something marks it dirty, and the
 * engine's change events (ADR-036) are what mark it dirty, so there is no
 * polling and no re-read per selection change.
 *
 * No Three.js dependency, so it is unit-tested on its own.
 */
export class ParentMap {
  private readonly read: () => readonly EntityHierarchyNode[];
  private parents = new Map<number, number | null>();
  private dirty = true;

  constructor(read: () => readonly EntityHierarchyNode[]) {
    this.read = read;
  }

  /** Marks the map dirty if the batch can change who exists or who is whose parent. */
  observe(events: readonly EngineEvent[]): void {
    if (affectsHierarchy(events)) {
      this.dirty = true;
    }
  }

  /** Forces the next refreshIfDirty to re-read. */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Re-reads the hierarchy if it has been marked dirty (it starts dirty).
   * If the read throws, the map stays dirty and the next call retries.
   */
  refreshIfDirty(): void {
    if (!this.dirty) return;
    this.parents = new Map(this.read().map((n) => [n.handle, n.parent_handle]));
    this.dirty = false;
  }

  /** True if the entity existed at the last read. */
  has(handle: number): boolean {
    return this.parents.has(handle);
  }

  /** Parent handle, or null for a root or an unknown entity. */
  parentOf(handle: number): number | null {
    return this.parents.get(handle) ?? null;
  }
}
