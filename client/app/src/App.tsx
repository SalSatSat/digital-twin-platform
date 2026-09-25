import { useCallback, useEffect, useRef, useState } from "react";
import { EngineView } from "./EngineView";
import { Inspector } from "./Inspector";
import { EntityHierarchyPanel } from "./EntityHierarchyPanel";
import { EMPTY_SELECTION, clear, prune, select, toggle } from "./selection";
import type { Selection } from "./selection";
import type { Engine } from "@dt-platform/renderer";

// The editor is reached via a distinct path ("/editor") rather than a
// query param, so that a future permissions layer can gate the whole
// route rather than conditional-rendering logic. No router library is
// installed yet — this is a minimal pathname check, not a full route
// tree; worth revisiting if /editor grows nested routes later.
function isEditorPath(): boolean {
  return window.location.pathname === "/editor";
}

function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [isEditMode, setIsEditMode] = useState(isEditorPath);

  // Read inside the stable callbacks below instead of closing over
  // isEditMode directly, so those callbacks' identities don't change
  // when isEditMode does — see handleEngineReady's comment.
  const isEditModeRef = useRef(isEditMode);
  useEffect(() => {
    isEditModeRef.current = isEditMode;
  }, [isEditMode]);

  // Removes any selected handle no longer alive in the ECS. Handles
  // can only die in Runtime (see unloadScene/boundary-respawn), so
  // this only ever has work to do right when (re-)entering edit mode
  // — called from every place that can cause that, below.
  const pruneSelection = (withEngine: Engine): void => {
    setSelection((prev) =>
      prune(prev, (h) => withEngine.listComponents(h).length > 0),
    );
  };

  // Keeps isEditMode in sync with browser back/forward navigation,
  // and prunes on a popstate-driven entry into edit mode — the same
  // as toggleEditMode below; popstate and that click are the only two
  // ways isEditMode can become true.
  useEffect(() => {
    const onPopState = () => {
      const next = isEditorPath();
      setIsEditMode(next);
      if (next && engine) pruneSelection(engine);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [engine]);

  // Passed to EngineView in place of setEngine directly. Identity
  // MUST stay stable ([] deps) — EngineView's setup effect depends on
  // onEngineReady, so a new identity here would tear down and
  // recreate the Engine/Renderer on every App render. isEditMode is
  // read via the ref above rather than closed over, for the same
  // reason. This also covers a fresh Engine instance (StrictMode
  // double-invoke or HMR) arriving while already in edit mode, so a
  // stale handle from the previous instance can't collide with a
  // newly spawned one.
  const handleEngineReady = useCallback((nextEngine: Engine | null): void => {
    setEngine(nextEngine);
    if (nextEngine && isEditModeRef.current) pruneSelection(nextEngine);
  }, []);

  // Shared by the viewport (on a hit) and the Hierarchy (always a hit).
  const handleSelect = (handle: number, opts: { additive: boolean }): void => {
    setSelection((prev) =>
      opts.additive ? toggle(prev, handle) : select(handle),
    );
  };

  // Viewport-only: unlike the Hierarchy, a pick can also be a miss
  // (empty space), which plain-clears but additive-ignores.
  const handleViewportPick = (
    handle: number | null,
    opts: { additive: boolean },
  ): void => {
    if (handle === null) {
      if (!opts.additive) setSelection(clear());
      return;
    }
    handleSelect(handle, opts);
  };

  // Navigates between "/" and "/editor" via pushState rather than a
  // real link/redirect, so the Engine/Renderer are never torn down —
  // scene state (entities, camera position, selection) survives the
  // toggle. Minimal placeholder until the Project/Console-style panel
  // tabs work gives this a real home.
  const toggleEditMode = (): void => {
    const next = !isEditMode;
    window.history.pushState({}, "", next ? "/editor" : "/");
    setIsEditMode(next);
    if (next && engine) pruneSelection(engine);
  };

  return (
    <div className="flex w-screen h-screen">
      {isEditMode && (
        <EntityHierarchyPanel
          engine={engine}
          selection={selection}
          onSelect={handleSelect}
        />
      )}
      <div className="flex-1 min-w-0 relative">
        <button
          onClick={toggleEditMode}
          className="absolute top-2 left-2 z-10 px-2 py-1 text-xs rounded bg-surface-raised border border-border text-text-primary"
        >
          {isEditMode ? "Exit Editor" : "Enter Editor"}
        </button>
        <EngineView
          onEngineReady={handleEngineReady}
          editMode={isEditMode}
          onEntityPicked={handleViewportPick}
        />
      </div>
      {isEditMode && (
        <Inspector engine={engine} selectedHandle={selection.primary} />
      )}
    </div>
  );
}

export default App;
