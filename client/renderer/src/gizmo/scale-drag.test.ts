import { describe, expect, it } from "vitest";
import { orientationSource, scaledLocal } from "./scale-drag";

describe("orientationSource", () => {
  it("lines up with the primary when it is a target", () => {
    expect(orientationSource(7, [3, 7])).toBe(7);
  });

  it("falls back to the first target when the primary is not one", () => {
    // Hidden, or moved by a selected ancestor instead.
    expect(orientationSource(9, [3, 7])).toBe(3);
  });

  it("uses the first target when there is no primary", () => {
    expect(orientationSource(null, [3, 7])).toBe(3);
  });

  it("has no source without targets, so the handles use world axes", () => {
    expect(orientationSource(5, [])).toBeNull();
  });
});

describe("scaledLocal", () => {
  it("multiplies the drag-start scale by the factor, axis by axis", () => {
    expect(scaledLocal([2, 3, 0.75], [1.5, 1, 0.5])).toEqual([3, 3, 0.375]);
  });

  it("keeps a negative factor, which mirrors", () => {
    expect(scaledLocal([2, 1, 1], [-1, 1, 1])).toEqual([-2, 1, 1]);
  });

  it.each([
    ["a zero factor", [1, 1, 1], [1, 0, 1]],
    ["a negative zero factor", [1, 1, 1], [1, -0, 1]],
    // Fine as a double (1e-50), but the engine receives f32 (a Float32Array),
    // where it is exactly zero and would be rejected.
    ["a product that is zero in f32", [1e-20, 1, 1], [1e-30, 1, 1]],
    // Likewise 1e40 is infinity in f32.
    ["a product that is infinite in f32", [1, 1e20, 1], [1, 1e20, 1]],
  ] as const)("skips the write for %s", (_label, start, factor) => {
    expect(scaledLocal(start, factor)).toBeNull();
  });

  it.each([
    ["NaN", [Number.NaN, 1, 1]],
    ["infinity", [1, Number.POSITIVE_INFINITY, 1]],
  ] as const)("skips the write for a factor of %s", (_label, factor) => {
    expect(scaledLocal([1, 1, 1], factor)).toBeNull();
  });
});
