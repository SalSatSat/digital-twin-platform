import { useEffect, useRef } from "react";
import { Engine, Renderer } from "@dt-platform/renderer";

/**
 * Mounts the Engine and Renderer, managing their full lifecycle.
 *
 * Engine is initialized first, then the Renderer backend is
 * initialized, then the scene is set up and the render loop starts.
 * Both are disposed when this component unmounts.
 */
export function EngineView() {
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
      }
    }

    start();

    return () => {
      isCancelled = true;
      renderer.dispose();
      engine.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100vw", height: "100vh", display: "block" }}
    />
  );
}
