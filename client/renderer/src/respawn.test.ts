import { describe, expect, it, vi } from "vitest";
import { RESPAWN_VELOCITY, respawnInPlace } from "./respawn";

const SPAWN_X = -12;
const HANDLE = 7;

/** An entity past the boundary at height 3, rotated, as the engine reports it. */
function engineWithEntity() {
  return {
    getPosition: vi.fn(() => Float32Array.of(13, 3, 0.5)),
    getRotation: vi.fn(() => Float32Array.of(0, 0.5, 0, 0.5)),
    setWorldTransform: vi.fn(),
    setComponentJson: vi.fn(),
  };
}

describe("respawnInPlace", () => {
  it("moves the entity to the spawn line, keeping its height and rotation", () => {
    const engine = engineWithEntity();

    respawnInPlace(engine, HANDLE, SPAWN_X);

    expect(engine.setWorldTransform).toHaveBeenCalledTimes(1);
    expect(engine.setWorldTransform).toHaveBeenCalledWith(
      HANDLE,
      [SPAWN_X, 3, 0],
      [0, 0.5, 0, 0.5],
    );
  });

  it("resets the entity's velocity", () => {
    const engine = engineWithEntity();

    respawnInPlace(engine, HANDLE, SPAWN_X);

    expect(engine.setComponentJson).toHaveBeenCalledTimes(1);
    expect(engine.setComponentJson).toHaveBeenCalledWith(
      HANDLE,
      "Velocity",
      JSON.stringify({ value: RESPAWN_VELOCITY }),
    );
  });

  it("reports that it respawned", () => {
    const engine = engineWithEntity();

    expect(respawnInPlace(engine, HANDLE, SPAWN_X)).toBe(true);
  });

  it("does nothing and reports false if the entity no longer exists", () => {
    const engine = {
      ...engineWithEntity(),
      getPosition: vi.fn(() => undefined),
    };

    const respawned = respawnInPlace(engine, HANDLE, SPAWN_X);

    expect(respawned).toBe(false);
    expect(engine.setWorldTransform).not.toHaveBeenCalled();
    expect(engine.setComponentJson).not.toHaveBeenCalled();
  });
});
