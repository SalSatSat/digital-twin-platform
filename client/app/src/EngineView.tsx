import { useEffect, useRef } from "react";
import { Engine, Renderer } from "@dt-platform/renderer";

interface EngineViewProps {
  onEngineReady: (engine: Engine | null) => void;
  /**
   * Whether the simulation is paused for editing. Toggling this does
   * NOT tear down or recreate the Engine/Renderer — it's forwarded to
   * the existing Renderer instance via setEditMode, so scene state
   * (entities, camera position, selection) survives the mode switch.
   */
  editMode: boolean;
  /**
   * Called with the picked entity's handle (or null for empty-space
   * click) on a plain left-click in the viewport while in edit mode.
   */
  onEntityPicked?: (handle: number | null) => void;
}

/**
 * Mounts the Engine and Renderer, managing their full lifecycle.
 *
 * Engine is initialized first, then the Renderer backend is
 * initialized, then the scene is set up and the render loop starts.
 * Both are disposed when this component unmounts.
 */
export function EngineView({
  onEngineReady,
  editMode,
  onEntityPicked,
}: EngineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The view gizmo's own small canvas — a separate THREE.WebGPURenderer,
  // independent of the main canvas's backend (WebGPU or WebGL).
  // See ViewGizmo's doc comment for why it's kept fully separate from the
  // main render pipeline.
  const gizmoCanvasRef = useRef<HTMLCanvasElement>(null);
  // The gizmo's bottom-center Persp/Ortho/Iso label — plain DOM,
  // updated imperatively by ViewGizmo each frame (its text/icon
  // changes rarely, so this is far cheaper than a React re-render
  // loop for something the render loop touches every frame).
  const gizmoLabelRef = useRef<HTMLDivElement>(null);
  // Holds the live Renderer instance so the editMode effect below can
  // reach it without being a dependency of the setup effect — toggling
  // editMode must not tear down and recreate the Engine/Renderer.
  const rendererRef = useRef<Renderer | null>(null);
  // Holds the latest onEntityPicked so the setup effect below doesn't
  // need it as a dependency — same reasoning as rendererRef/editMode.
  const onEntityPickedRef = useRef(onEntityPicked);

  useEffect(() => {
    onEntityPickedRef.current = onEntityPicked;
  }, [onEntityPicked]);

  useEffect(() => {
    if (
      !canvasRef.current ||
      !gizmoCanvasRef.current ||
      !gizmoLabelRef.current
    ) {
      return;
    }
    const engine = new Engine();
    const renderer = new Renderer(
      canvasRef.current,
      gizmoCanvasRef.current,
      gizmoLabelRef.current,
      engine,
    );
    rendererRef.current = renderer;
    renderer.setOnEntityPicked((handle) => onEntityPickedRef.current?.(handle));
    let isCancelled = false;
    async function start() {
      await engine.initialize();
      await renderer.initialize();
      if (!isCancelled) {
        renderer.setup();
        renderer.start();
        onEngineReady(engine);
      }
    }
    start();
    return () => {
      isCancelled = true;
      onEngineReady(null);
      rendererRef.current = null;
      renderer.dispose();
      engine.dispose();
    };
  }, [onEngineReady]);

  useEffect(() => {
    rendererRef.current?.setEditMode(editMode);
  }, [editMode]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <div
        className="absolute top-2 right-2 flex flex-col items-center gap-1"
        style={{ display: editMode ? "flex" : "none" }}
      >
        <canvas
          ref={gizmoCanvasRef}
          className="rounded-full"
          style={{ width: "108px", height: "108px" }}
        />
        <div
          ref={gizmoLabelRef}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none bg-surface-raised border border-border text-text-primary"
        />
      </div>
    </>
  );
}
