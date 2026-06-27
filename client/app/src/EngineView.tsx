import { useEffect, useRef } from "react";
import { Engine, Renderer } from "@dt-platform/renderer";

/**
 * Mounts the Engine and Renderer, managing their full lifecycle.
 *
 * Engine is created first and initialized before the Renderer
 * is set up — the Renderer reads from Engine but does not own it.
 * Both are disposed when this component unmounts.
 */
export function EngineView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new Engine();
    const renderer = new Renderer(canvasRef.current, engine);
    let isCancelled = false;

    engine.initialize().then(() => {
      if (!isCancelled) {
        renderer.setup();
        renderer.start();
      }
    });

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
