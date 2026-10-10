import { useEffect, useState } from "react";
import type { Engine, EntityHierarchyNode } from "@dt-platform/renderer";
import { HierarchyError, affectsEntityListing } from "@dt-platform/renderer";
import type { Selection } from "./selection";

interface EntityHierarchyPanelProps {
  engine: Engine | null;
  selection: Selection;
  onSelect: (handle: number, opts: { additive: boolean }) => void;
}

/**
 * Runtime Editor's entity hierarchy panel — lists every live entity as
 * a tree (parent/children reconstructed client-side from the flat list
 * the WASM boundary returns), lets the user select one (replacing the
 * Inspector's former temporary numeric handle input), and supports
 * drag-and-drop reparenting via setParent/removeParent.
 *
 * Stays in sync through the engine's change events (ADR-036): it subscribes
 * first, then fetches a snapshot, and refetches whenever a frame's batch
 * can change what the list shows (a spawn, despawn, reparent, rename or
 * resync). A drag-and-drop reparent shows up on the next frame through the
 * same path; there is no polling.
 *
 * Cycle/invalid-target rejection is NOT checked client-side before a
 * drop — World::set_parent's existing cycle detection is the single
 * source of truth for validity; the UI just attempts the drop and
 * surfaces the resulting HierarchyError inline, same pattern as
 * Camera's near/far validation in the Inspector.
 */
export function EntityHierarchyPanel({
  engine,
  selection,
  onSelect,
}: EntityHierarchyPanelProps) {
  const [nodes, setNodes] = useState<EntityHierarchyNode[]>([]);
  const [draggedHandle, setDraggedHandle] = useState<number | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!engine) return;
    const fetchHierarchy = () => {
      const json = engine.listEntityHierarchy();
      setNodes(JSON.parse(json) as EntityHierarchyNode[]);
    };
    // Subscribe before fetching, so no event falls between the snapshot and
    // the first batch.
    const unsubscribe = engine.events.subscribe((batch) => {
      if (affectsEntityListing(batch)) fetchHierarchy();
    });
    fetchHierarchy();
    return unsubscribe;
  }, [engine]);

  if (!engine) {
    return (
      <div className="w-60 shrink-0 p-4 bg-surface text-text-primary text-sm overflow-y-auto flex flex-col">
        <p>Initializing engine…</p>
      </div>
    );
  }

  // The Scene Camera (Editor context) is a client-navigation tool, not
  // an entity the user edits — it's excluded from the hierarchy the
  // same way it's excluded from being the "runtime" viewpoint.
  const visibleNodes = nodes.filter((n) => !n.contexts.includes("Editor"));

  const childrenOf = (parentHandle: number | null): EntityHierarchyNode[] =>
    visibleNodes.filter((n) => n.parent_handle === parentHandle);

  function toggleCollapsed(handle: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) {
        next.delete(handle);
      } else {
        next.add(handle);
      }
      return next;
    });
  }

  const handleDrop = (targetHandle: number) => {
    if (draggedHandle === null || draggedHandle === targetHandle) {
      setDraggedHandle(null);
      return;
    }
    try {
      engine.setParent(draggedHandle, targetHandle);
      setDropError(null);
      // The list refreshes from the reparent event on the next frame.
    } catch (e) {
      setDropError(e instanceof HierarchyError ? e.message : String(e));
    }
    setDraggedHandle(null);
  };

  const handleDropToRoot = () => {
    if (draggedHandle === null) return;
    try {
      engine.removeParent(draggedHandle);
      setDropError(null);
    } catch (e) {
      setDropError(e instanceof HierarchyError ? e.message : String(e));
    }
    setDraggedHandle(null);
  };

  const renderNode = (node: EntityHierarchyNode): React.ReactNode => {
    const children = childrenOf(node.handle);
    const hasChildren = children.length > 0;
    const isPrimary = node.handle === selection.primary;
    const isSelected = selection.handles.includes(node.handle);
    const isDragTarget =
      draggedHandle !== null && draggedHandle !== node.handle;
    const isCollapsed = collapsed.has(node.handle);

    return (
      <div key={node.handle}>
        <div
          draggable
          onDragStart={() => setDraggedHandle(node.handle)}
          onDragOver={(e) => {
            if (isDragTarget) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(node.handle);
          }}
          onClick={(e) =>
            onSelect(node.handle, { additive: e.ctrlKey || e.metaKey })
          }
          className={
            isPrimary
              ? "flex items-center gap-1 cursor-grab px-1 py-0.5 rounded bg-accent/30 text-text-primary"
              : isSelected
                ? "flex items-center gap-1 cursor-grab px-1 py-0.5 rounded bg-accent/15 text-text-primary"
                : "flex items-center gap-1 cursor-grab px-1 py-0.5 rounded text-text-primary hover:bg-surface-raised"
          }
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleCollapsed(node.handle);
            }}
            className={`w-3 shrink-0 text-xs text-text-muted ${hasChildren ? "cursor-pointer" : ""}`}
          >
            {hasChildren ? (isCollapsed ? "▸" : "▾") : ""}
          </span>
          <span className="w-3 h-3 shrink-0 rounded-sm border border-text-muted" />
          <span className="truncate">{node.name}</span>
        </div>
        {hasChildren && !isCollapsed && (
          <div className="ml-4">{children.map(renderNode)}</div>
        )}
      </div>
    );
  };

  const roots = childrenOf(null);

  return (
    <div className="w-60 shrink-0 p-4 bg-surface text-text-primary text-sm overflow-y-auto flex flex-col">
      <h3 className="mb-2 font-semibold">Hierarchy</h3>
      {dropError && <p className="text-text-error text-xs">{dropError}</p>}
      <div className="flex-1">
        {roots.length === 0 && <p className="text-text-muted">No entities.</p>}
        {roots.map(renderNode)}
      </div>
      <div
        onDragOver={(e) => {
          if (draggedHandle !== null) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDropToRoot();
        }}
        className="mt-2 p-2 border-t border-dashed border-border text-xs text-text-muted"
      >
        Drop here to un-parent
      </div>
    </div>
  );
}
