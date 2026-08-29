import { useEffect, useState } from "react";
import { EngineView } from "./EngineView";
import { Inspector } from "./Inspector";
import { EntityHierarchyPanel } from "./EntityHierarchyPanel";
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
  const [selectedHandle, setSelectedHandle] = useState<number | null>(null);
  const [isEditMode, setIsEditMode] = useState(isEditorPath);

  // Keeps isEditMode in sync with browser back/forward navigation.
  useEffect(() => {
    const onPopState = () => setIsEditMode(isEditorPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Navigates between "/" and "/editor" via pushState rather than a
  // real link/redirect, so the Engine/Renderer are never torn down —
  // scene state (entities, camera position, selection) survives the
  // toggle. Minimal placeholder until the Project/Console-style panel
  // tabs work gives this a real home.
  const toggleEditMode = (): void => {
    const next = !isEditMode;
    window.history.pushState({}, "", next ? "/editor" : "/");
    setIsEditMode(next);
  };

  return (
    <div className="flex w-screen h-screen">
      {isEditMode && (
        <EntityHierarchyPanel
          engine={engine}
          selectedHandle={selectedHandle}
          onSelect={setSelectedHandle}
        />
      )}
      <div className="flex-1 min-w-0 relative">
        <button
          onClick={toggleEditMode}
          className="absolute top-2 left-2 z-10 px-2 py-1 text-xs rounded bg-surface-raised border border-border text-text-primary"
        >
          {isEditMode ? "Exit Editor" : "Enter Editor"}
        </button>
        <EngineView onEngineReady={setEngine} editMode={isEditMode} />
      </div>
      {isEditMode && (
        <Inspector engine={engine} selectedHandle={selectedHandle} />
      )}
    </div>
  );
}

export default App;
