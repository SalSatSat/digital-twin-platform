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

  const panelStyle: React.CSSProperties = {
    width: 240,
    flexShrink: 0,
    padding: 16,
    background: "#252525",
    color: "#e0e0e0",
    fontFamily: "sans-serif",
    fontSize: 13,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  };

  if (!engine) {
    return (
      <div style={panelStyle}>
        <p>Initializing engine…</p>
      </div>
    );
  }

  const childrenOf = (parentHandle: number | null): EntityHierarchyNode[] =>
    nodes.filter((n) => n.parent_handle === parentHandle);

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
    const isSelected = node.handle === selectedHandle;
    const isDragTarget =
      draggedHandle !== null && draggedHandle !== node.handle;
    return (
      <div key={node.handle} style={{ marginLeft: 12 }}>
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
          style={{
            cursor: "grab",
            padding: "2px 4px",
            borderRadius: 3,
            background: isSelected ? "#3a5f8a" : "transparent",
          }}
        >
          {node.name}
        </div>
        {children.map(renderNode)}
      </div>
    );
  };

  const roots = childrenOf(null);

  return (
    <div style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Entity Hierarchy</h3>
      {dropError && (
        <p style={{ color: "#e57373", fontSize: 12 }}>{dropError}</p>
      )}
      <div style={{ flex: 1 }}>
        {roots.length === 0 && <p>No entities.</p>}
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
        style={{
          marginTop: 8,
          padding: 8,
          borderTop: "1px dashed #444",
          fontSize: 11,
          color: "#888",
        }}
      >
        Drop here to un-parent
      </div>
    </div>
  );
}
