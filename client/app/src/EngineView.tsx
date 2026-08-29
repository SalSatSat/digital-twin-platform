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
}

/**
 * Mounts the Engine and Renderer, managing their full lifecycle.
 *
 * Engine is initialized first, then the Renderer backend is
 * initialized, then the scene is set up and the render loop starts.
 * Both are disposed when this component unmounts.
 */
export function EngineView({ onEngineReady, editMode }: EngineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Holds the live Renderer instance so the editMode effect below can
  // reach it without being a dependency of the setup effect — toggling
  // editMode must not tear down and recreate the Engine/Renderer.
  const rendererRef = useRef<Renderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine();
    const renderer = new Renderer(canvasRef.current, engine);
    rendererRef.current = renderer;
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
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
