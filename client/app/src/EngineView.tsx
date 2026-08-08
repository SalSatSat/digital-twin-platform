import { useEffect, useRef } from "react";
import { Engine, Renderer } from "@dt-platform/renderer";

interface EngineViewProps {
  onEngineReady: (engine: Engine | null) => void;
}

/**
 * Mounts the Engine and Renderer, managing their full lifecycle.
 *
 * Engine is initialized first, then the Renderer backend is
 * initialized, then the scene is set up and the render loop starts.
 * Both are disposed when this component unmounts.
 */
export function EngineView({ onEngineReady }: EngineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine();
    const renderer = new Renderer(canvasRef.current, engine);
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
      renderer.dispose();
      engine.dispose();
    };
  }, [onEngineReady]);
  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
