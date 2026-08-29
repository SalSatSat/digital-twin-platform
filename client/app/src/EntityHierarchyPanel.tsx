import { useEffect, useState } from "react";
import type { Engine, EntityHierarchyNode } from "@dt-platform/renderer";
import { HierarchyError } from "@dt-platform/renderer";

interface EntityHierarchyPanelProps {
  engine: Engine | null;
  selectedHandle: number | null;
  onSelect: (handle: number) => void;
}

/**
 * Runtime Editor's entity hierarchy panel — lists every live entity as
 * a tree (parent/children reconstructed client-side from the flat list
 * the WASM boundary returns), lets the user select one (replacing the
 * Inspector's former temporary numeric handle input), and supports
 * drag-and-drop reparenting via setParent/removeParent.
 *
 * Polls listEntityHierarchy() on an interval rather than fetching once,
 * since there's no Event Bus yet to push spawn/despawn/reparent
 * notifications — see Phase 13 design discussion for why polling (not
 * a one-time fetch, not per-tick) was the agreed trade-off. A
 * successful drag-and-drop drop triggers an immediate extra fetch on
 * top of the interval, so reparenting feels instant rather than
 * waiting up to ~1s for the next poll tick.
 *
 * Cycle/invalid-target rejection is NOT checked client-side before a
 * drop — World::set_parent's existing cycle detection is the single
 * source of truth for validity; the UI just attempts the drop and
 * surfaces the resulting HierarchyError inline, same pattern as
 * Camera's near/far validation in the Inspector.
 */
export function EntityHierarchyPanel({
  engine,
  selectedHandle,
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
    fetchHierarchy();
    const intervalId = setInterval(fetchHierarchy, 1000);
    return () => clearInterval(intervalId);
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
      setNodes(
        JSON.parse(engine.listEntityHierarchy()) as EntityHierarchyNode[],
      );
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
      setNodes(
        JSON.parse(engine.listEntityHierarchy()) as EntityHierarchyNode[],
      );
    } catch (e) {
      setDropError(e instanceof HierarchyError ? e.message : String(e));
    }
    setDraggedHandle(null);
  };

  const renderNode = (node: EntityHierarchyNode): React.ReactNode => {
    const children = childrenOf(node.handle);
    const hasChildren = children.length > 0;
    const isSelected = node.handle === selectedHandle;
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
          onClick={() => onSelect(node.handle)}
          className={
            isSelected
              ? "flex items-center gap-1 cursor-grab px-1 py-0.5 rounded bg-accent/30 text-text-primary"
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
