/**
 * Editor viewport/Hierarchy selection state. Owned by App, shared by
 * EngineView (viewport picks) and EntityHierarchyPanel (row clicks) so
 * both follow identical toggle/replace/clear semantics.
 *
 * `handles` is in selection order (oldest first), used only to decide
 * which handle to promote to primary when the primary is toggled off.
 * `primary` drives the Inspector — it shows exactly one entity.
 */
export interface Selection {
  readonly handles: readonly number[];
  readonly primary: number | null;
}

export const EMPTY_SELECTION: Selection = { handles: [], primary: null };

/** Replaces the selection with a single handle. */
export function select(handle: number): Selection {
  return { handles: [handle], primary: handle };
}

/** Clears the selection entirely. */
export function clear(): Selection {
  return EMPTY_SELECTION;
}

/**
 * Toggles `handle` in the selection. Toggling it on makes it primary.
 * Toggling off the primary promotes the most recently added remaining
 * handle; toggling off a non-primary handle leaves primary unchanged.
 */
export function toggle(selection: Selection, handle: number): Selection {
  const isSelected = selection.handles.includes(handle);
  if (isSelected) {
    const handles = selection.handles.filter((h) => h !== handle);
    const primary =
      selection.primary === handle
        ? (handles[handles.length - 1] ?? null)
        : selection.primary;
    return { handles, primary };
  }
  return { handles: [...selection.handles, handle], primary: handle };
}

/**
 * Removes any handle no longer alive in the ECS, per `exists`. Returns
 * the same Selection instance when nothing changed, so callers can
 * skip a re-render on a no-op prune.
 */
export function prune(
  selection: Selection,
  exists: (handle: number) => boolean,
): Selection {
  const handles = selection.handles.filter(exists);
  if (handles.length === selection.handles.length) return selection;
  const primary =
    selection.primary !== null && exists(selection.primary)
      ? selection.primary
      : (handles[handles.length - 1] ?? null);
  return { handles, primary };
}
