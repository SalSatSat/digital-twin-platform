import { useState } from "react";
import type { Engine } from "@dt-platform/renderer";
import type { FieldRendererProps } from "./inspector/FieldRenderer";
import { LocalTransformField } from "./inspector/LocalTransformField";
import { VelocityField } from "./inspector/VelocityField";

const fieldRegistry: Record<string, React.ComponentType<FieldRendererProps>> = {
  Velocity: VelocityField,
  LocalTransform: LocalTransformField,
};

interface InspectorProps {
  engine: Engine | null;
}

/**
 * Runtime Editor Inspector panel — lets the user select an entity by
 * handle and view/edit its reflectable components.
 *
 * Entity selection is a temporary numeric handle input for now; a real
 * hierarchy/entity-list panel is future work (Phase 13 continues).
 * Component values themselves are not yet editable here — this is the
 * shell (selection + component-kind listing) that per-kind field
 * renderers will be added into next.
 */
export function Inspector({ engine }: InspectorProps) {
  const [handleInput, setHandleInput] = useState("");

  const panelStyle: React.CSSProperties = {
    width: 320,
    flexShrink: 0,
    padding: 16,
    background: "#1e1e1e",
    color: "#e0e0e0",
    fontFamily: "sans-serif",
    fontSize: 13,
    overflowY: "auto",
  };

  if (!engine) {
    return (
      <div style={panelStyle}>
        <p>Initializing engine…</p>
      </div>
    );
  }

  const parsedHandle = handleInput.trim() === "" ? null : Number(handleInput);
  const hasValidHandle =
    parsedHandle !== null &&
    Number.isInteger(parsedHandle) &&
    parsedHandle >= 0;

  const componentKinds = hasValidHandle
    ? engine.listComponents(parsedHandle)
    : [];

  return (
    <div style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Inspector</h3>
      <label style={{ display: "block", marginBottom: 12 }}>
        Entity handle:{" "}
        <input
          type="number"
          min={0}
          value={handleInput}
          onChange={(e) => setHandleInput(e.target.value)}
          style={{ width: 100 }}
        />
      </label>

      {handleInput.trim() !== "" && !hasValidHandle && (
        <p style={{ color: "#e57373" }}>Enter a valid non-negative handle.</p>
      )}

      {hasValidHandle && componentKinds.length === 0 && (
        <p>No reflectable components on this entity (or it doesn't exist).</p>
      )}

      {hasValidHandle &&
        componentKinds.map((kind) => {
          const Renderer = fieldRegistry[kind];
          return (
            <div
              key={kind}
              style={{
                border: "1px solid #3a3a3a",
                borderRadius: 4,
                padding: 8,
                marginBottom: 8,
              }}
            >
              {Renderer ? (
                <Renderer engine={engine} handle={parsedHandle!} />
              ) : (
                <>
                  <strong>{kind}</strong>
                  <p style={{ color: "#888", margin: "4px 0 0" }}>
                    (field renderer coming next)
                  </p>
                </>
              )}
            </div>
          );
        })}
    </div>
  );
}
