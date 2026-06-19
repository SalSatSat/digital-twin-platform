import { useEffect, useRef } from "react";
import { Renderer } from "@dt-platform/renderer";

/**
 * Mounts the Renderer onto a canvas element and manages its lifecycle.
 *
 * The Renderer is created when this component mounts and disposed when
 * it unmounts, ensuring WASM and Three.js resources are properly cleaned
 * up when the component is no longer in use.
 */
export function EngineView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const renderer = new Renderer(canvasRef.current);
    let isCancelled = false;

    renderer.initialize().then(() => {
      // Guard against the component unmounting before initialize() resolves
      if (!isCancelled) {
        renderer.start();
      }
    });

    // Cleanup function — runs when the component unmounts
    return () => {
      isCancelled = true;
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
