import { useState } from "react";
import { EngineView } from "./EngineView";
import { Inspector } from "./Inspector";
import { EntityHierarchyPanel } from "./EntityHierarchyPanel";
import type { Engine } from "@dt-platform/renderer";

function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [selectedHandle, setSelectedHandle] = useState<number | null>(null);
  return (
    <div className="flex w-screen h-screen">
      <EntityHierarchyPanel
        engine={engine}
        selectedHandle={selectedHandle}
        onSelect={setSelectedHandle}
      />
      <div className="flex-1 min-w-0">
        <EngineView onEngineReady={setEngine} />
      </div>
      <Inspector engine={engine} selectedHandle={selectedHandle} />
    </div>
  );
}

export default App;
