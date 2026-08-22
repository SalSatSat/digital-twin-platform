import { useState } from "react";
import type { Engine } from "@dt-platform/renderer";
import type { FieldRendererProps } from "./inspector/FieldRenderer";
import { CameraField } from "./inspector/CameraField";
import { EntityInfoField } from "./inspector/EntityInfoField";
import { LocalTransformField } from "./inspector/LocalTransformField";
import { VelocityField } from "./inspector/VelocityField";

const fieldRegistry: Record<string, React.ComponentType<FieldRendererProps>> = {
  Camera: CameraField,
  LocalTransform: LocalTransformField,
  Velocity: VelocityField,
};

const displayNames: Record<string, string> = {
  LocalTransform: "Transform",
  Camera: "Camera",
  Velocity: "Velocity",
};

interface InspectorProps {
  engine: Engine | null;
  selectedHandle: number | null;
}

export function Inspector({ engine, selectedHandle }: InspectorProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function toggleCollapsed(kind: string) {
    setCollapsed((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }

  if (!engine) {
    return (
      <div className="w-80 shrink-0 p-4 bg-surface text-text-primary text-sm overflow-y-auto">
        <p>Initializing engine…</p>
      </div>
    );
  }

  const allKinds =
    selectedHandle !== null ? engine.listComponents(selectedHandle) : [];
  const hasEntityInfo = allKinds.includes("EntityInfo");
  const componentKinds = allKinds.filter((k) => k !== "EntityInfo");

  return (
    <div className="w-80 shrink-0 bg-surface text-text-primary text-sm overflow-y-auto">
      <h3 className="px-4 py-3 font-semibold">Inspector</h3>
      {selectedHandle === null && (
        <p className="px-4 text-text-muted">
          Select an entity from the hierarchy.
        </p>
      )}
      {selectedHandle !== null && allKinds.length === 0 && (
        <p className="px-4 text-text-muted">
          No reflectable components on this entity (or it doesn't exist).
        </p>
      )}
      {hasEntityInfo && (
        <div className="px-4 pb-3 border-b border-border">
          <EntityInfoField
            key={selectedHandle}
            engine={engine}
            handle={selectedHandle!}
          />
        </div>
      )}
      {componentKinds.map((kind) => {
        const Renderer = fieldRegistry[kind];
        const isCollapsed = collapsed[kind] ?? false;
        return (
          <div
            key={`${kind}-${selectedHandle}`}
            className="border-b border-border"
          >
            <button
              type="button"
              onClick={() => toggleCollapsed(kind)}
              className="w-full flex items-center gap-1 px-4 py-2 text-left text-xs font-semibold text-text-muted hover:text-text-primary"
            >
              <span
                className={
                  isCollapsed
                    ? "-rotate-90 inline-block transition-transform"
                    : "inline-block transition-transform"
                }
              >
                ▾
              </span>
              {displayNames[kind] ?? kind}
            </button>
            {!isCollapsed && (
              <div className="px-4 pb-3">
                {Renderer ? (
                  <Renderer engine={engine} handle={selectedHandle!} />
                ) : (
                  <p className="text-text-muted">
                    (field renderer coming next)
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
