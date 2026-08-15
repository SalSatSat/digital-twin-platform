import { useState } from "react";
import { EngineView } from "./EngineView";
import { Inspector } from "./Inspector";
import { EntityHierarchyPanel } from "./EntityHierarchyPanel";
import type { Engine } from "@dt-platform/renderer";

function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [selectedHandle, setSelectedHandle] = useState<number | null>(null);

  return (
    <div
      style={{ display: "flex", width: "100vw", height: "100vh", margin: 0 }}
    >
      <EntityHierarchyPanel
        engine={engine}
        selectedHandle={selectedHandle}
        onSelect={setSelectedHandle}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <EngineView onEngineReady={setEngine} />
      </div>
      <Inspector engine={engine} selectedHandle={selectedHandle} />
    </div>
  );
}
export default App;
