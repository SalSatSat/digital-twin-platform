import { useEffect, useMemo, useReducer, useState } from "react";
import {
  addDefaultComponent,
  addableKinds,
  affectsEntity,
  parseComponentKinds,
  removeOptionalComponent,
  type ComponentKindInfo,
  type Engine,
} from "@dt-platform/renderer";
import type { FieldRendererProps } from "./inspector/FieldRenderer";
import { AddComponentMenu } from "./inspector/AddComponentMenu";
import { CameraField } from "./inspector/CameraField";
import { EntityInfoField } from "./inspector/EntityInfoField";
import { LocalTransformField } from "./inspector/LocalTransformField";
import { VelocityField } from "./inspector/VelocityField";

const fieldRegistry: Record<string, React.ComponentType<FieldRendererProps>> = {
  Camera: CameraField,
  LocalTransform: LocalTransformField,
  Velocity: VelocityField,
};

interface InspectorProps {
  engine: Engine | null;
  selectedHandle: number | null;
}

export function Inspector({ engine, selectedHandle }: InspectorProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // The last rejected add or remove, tagged with the entity it was for so it
  // stops showing when the selection changes, with no effect to clear it.
  const [editError, setEditError] = useState<{
    handle: number;
    message: string;
  } | null>(null);

  // Reads the component kinds from the reflection registry (Rust's single
  // source of truth for them — see reflection.rs's ComponentDescriptor)
  // rather than keeping a second hardcoded copy here: the section-header
  // names, and which kinds can be added and removed (ADR-037). The registry
  // is static for the process's lifetime, so this only needs to be parsed
  // once per Engine instance, not per render or per selection.
  const kindInfos = useMemo<ComponentKindInfo[]>(
    () => (engine ? parseComponentKinds(engine.listComponentKinds()) : []),
    [engine],
  );
  const kindInfoByName = useMemo(
    () => new Map(kindInfos.map((info) => [info.kind, info])),
    [kindInfos],
  );

  // Re-render when the selected entity is spawned, despawned, resynced, or
  // gains or loses a component: the component list below is read during
  // render and would otherwise go stale.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!engine || selectedHandle === null) return;
    return engine.events.subscribe((batch) => {
      if (affectsEntity(batch, selectedHandle)) rerender();
    });
  }, [engine, selectedHandle]);

  function toggleCollapsed(kind: string) {
    setCollapsed((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }

  // The engine's own message is shown as is; null clears any earlier one.
  function reportEdit(handle: number, message: string | null) {
    setEditError(message === null ? null : { handle, message });
  }

  function addComponent(kind: string) {
    if (!engine || selectedHandle === null) return;
    reportEdit(
      selectedHandle,
      addDefaultComponent(engine, selectedHandle, kind),
    );
  }

  function removeComponent(kind: string) {
    if (!engine || selectedHandle === null) return;
    reportEdit(
      selectedHandle,
      removeOptionalComponent(engine, selectedHandle, kind),
    );
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
  const addable =
    selectedHandle !== null ? addableKinds(kindInfos, allKinds) : [];
  const visibleError =
    editError?.handle === selectedHandle ? editError.message : null;

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
        const info = kindInfoByName.get(kind);
        return (
          <div
            key={`${kind}-${selectedHandle}`}
            className="border-b border-border"
          >
            <div className="flex items-center pr-2">
              <button
                type="button"
                onClick={() => toggleCollapsed(kind)}
                className="min-w-0 flex-1 flex items-center gap-1 px-4 py-2 text-left text-xs font-semibold text-text-muted hover:text-text-primary"
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
                {info?.displayName ?? kind}
              </button>
              {info?.optional && (
                <button
                  type="button"
                  aria-label={`Remove ${info.displayName}`}
                  title={`Remove ${info.displayName}`}
                  onClick={() => removeComponent(kind)}
                  className="px-2 py-1 text-xs text-text-muted hover:text-text-error"
                >
                  ✕
                </button>
              )}
            </div>
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
      {visibleError !== null && (
        <p role="alert" className="px-4 pt-2 text-text-error text-xs">
          {visibleError}
        </p>
      )}
      {addable.length > 0 && (
        <AddComponentMenu
          key={selectedHandle}
          kinds={addable}
          onAdd={addComponent}
        />
      )}
    </div>
  );
}
