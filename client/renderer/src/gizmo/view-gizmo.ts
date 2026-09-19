import * as THREE from "three/webgpu";
import { GRID_CONFIG } from "../grid/grid-config";
import { matchPreset } from "./view-presets";
import type { ViewPreset } from "./view-presets";

// Sizing — all in the gizmo's own local unit space, unrelated to
// world units. First-pass values for a small corner widget; tune by
// eye once actually seen rendered, same as the grid's fade distance.
const PIN_HEAD_RADIUS = 0.16;
const PIN_HEAD_HEIGHT = 0.54;
const LABEL_SCALE = 0.48;
const LABEL_GAP = 0.5;
const CUBE_SIZE = 0.5;
const HOVER_BRIGHTEN = 1.3;

// Matches GRID_CONFIG's X/Z axis colors (grid-config.ts) so the
// widget's arms and the reference grid's origin lines read as the
// same axes. No equivalent Y constant exists on the grid (it's a
// ground-plane grid, no vertical axis line) — picked to sit at
// similar brightness/saturation to the other two.
const Y_AXIS_COLOR: [number, number, number] = [0.35, 0.85, 0.35];

// Negative-axis pins are deliberately achromatic (not a dimmed shade
// of the positive color) — the spec calls for only positive axes to
// read as "colored" at all, not just less saturated.
const NEGATIVE_PIN_COLOR = 0x6b6b6b;
const CUBE_COLOR = 0x9a9a9a;
const LABEL_TEXT_COLOR = "#f2f2f2";

/** Bakes a transparent-background canvas texture with just a letter on it. */
function createLabelTexture(text: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LABEL_TEXT_COLOR;
  ctx.fillText(text, size / 2, size / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Pin {
  preset: ViewPreset;
  // The clickable/hoverable head — a real 3D cone, not a billboarded
  // sprite, so it reads as a pin with an actual silhouette.
  cone: THREE.Mesh;
  // Only the three positive-axis pins have one.
  label: THREE.Sprite | null;
}

// Which two presets share an axis — used to decide which pins stay
// visible once the gizmo is aligned to one of them. See
// updatePinVisibility()'s doc comment.
const AXIS_PAIR: Record<ViewPreset, readonly [ViewPreset, ViewPreset]> = {
  Top: ["Top", "Bottom"],
  Bottom: ["Top", "Bottom"],
  Left: ["Left", "Right"],
  Right: ["Left", "Right"],
  Front: ["Front", "Back"],
  Back: ["Front", "Back"],
};

// Inline SVG icons for the bottom label — kept tiny and dependency-
// free rather than pulling in an icon library for three glyphs.
// `currentColor` picks up the label element's own CSS color.
const ICON_PERSPECTIVE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 9.5 L4 2.5 L8 2.5 L10 9.5 Z" stroke="currentColor" stroke-width="1"/></svg>`;
const ICON_ALIGNED = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="8" height="8" stroke="currentColor" stroke-width="1"/></svg>`;
const ICON_ISO = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 1 L10.5 3.5 V8.5 L6 11 L1.5 8.5 V3.5 Z M6 1 V6 M6 6 L10.5 3.5 M6 6 L1.5 3.5" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>`;

/**
 * A Unity-style Scene View orientation overlay — a small corner
 * widget with 6 clickable axis pins around a center cube, plus a
 * bottom-center label showing the current view/projection state.
 *
 * Clicking a pin fires onPresetSelected; clicking the cube fires
 * onToggleProjection. Actually moving the camera or flipping its
 * projection is SceneManager's job (see SceneManager.snapToPreset and
 * toggleEditorCameraProjection) — ViewGizmo only owns the widget's
 * own visuals, click/hover detection, and the bottom label's text.
 *
 * Takes existing DOM elements (created and CSS-positioned by
 * EngineView.tsx, the same way the main canvas is) rather than
 * creating its own — keeps DOM ownership with React, Three.js/
 * rendering concerns here, consistent with how the main canvas is
 * already split between EngineView and Renderer.
 *
 * Rendered with its own plain THREE.WebGPURenderer rather than
 * composited into the main scene or the main render backend. The
 * widget's materials are flat, unlit colors, so it needs neither the
 * WebGPU backend nor an ADR-031-style GLSL/TSL material pair — and
 * keeping it fully separate means the main render pipeline never has
 * to know it exists.
 */
export class ViewGizmo {
  private canvas: HTMLCanvasElement;
  private labelElement: HTMLElement;
  private renderer: THREE.WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private root: THREE.Group;
  private pins: Pin[] = [];
  private cube: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private hoveredCone: THREE.Mesh | null = null;
  private hoveredCube = false;
  private onPresetSelected: ((preset: ViewPreset) => void) | null = null;
  private onToggleProjection: (() => void) | null = null;
  // Avoids redundant DOM/visibility writes when nothing's actually
  // changed since last frame — cheap to compute, but no reason to
  // force these every frame at 60fps for an unchanged result.
  private lastLabelKey: string | null = null;
  private lastMatched: ViewPreset | null | undefined = undefined;

  constructor(canvas: HTMLCanvasElement, labelElement: HTMLElement) {
    this.canvas = canvas;
    this.labelElement = labelElement;
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    this.camera.position.set(0, 0, 4);
    this.camera.lookAt(0, 0, 0);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.cube = this.buildCube();
    this.root.add(this.cube);
    this.buildPins();
    this.resize();

    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("mousemove", this.onMouseMove);
  }

  /** Sets the callback fired when the user clicks a pin. */
  setOnPresetSelected(fn: (preset: ViewPreset) => void): void {
    this.onPresetSelected = fn;
  }

  /** Sets the callback fired when the user clicks the center cube. */
  setOnToggleProjection(fn: () => void): void {
    this.onToggleProjection = fn;
  }

  /**
   * Resizes the gizmo's own renderer/camera to match its canvas's
   * current CSS size. Call whenever the main canvas resizes — the
   * gizmo canvas doesn't have its own ResizeObserver, it piggybacks
   * on Renderer's existing one.
   */
  resize(): void {
    const size = this.canvas.clientWidth || 1;
    this.renderer.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Orients the widget to reflect the main camera's current facing,
   * updates the bottom label and pin visibility, and re-renders the
   * mini-scene. Call once per frame while the gizmo is visible.
   *
   * @param mainCameraQuaternion - the main viewport camera's current orientation.
   * @param isOrthographic - whether the main viewport camera is currently orthographic.
   */
  update(
    mainCameraQuaternion: THREE.Quaternion,
    isOrthographic: boolean,
  ): void {
    // The widget rotates opposite to the camera so its axis labels
    // always show which way the *world* axes point from the current
    // viewpoint — same convention as Unity/Blender's gizmo.
    this.root.quaternion.copy(mainCameraQuaternion).invert();

    // Computed once and shared by both the label and pin visibility —
    // both care about the same "is the camera exactly aligned to a
    // preset, and if so which one" fact.
    const matched = matchPreset(mainCameraQuaternion);
    this.updateLabel(matched, isOrthographic);
    this.updatePinVisibility(matched);

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    for (const pin of this.pins) {
      pin.cone.geometry.dispose();
      if (pin.cone.material instanceof THREE.Material)
        pin.cone.material.dispose();
      if (pin.label) {
        (pin.label.material as THREE.SpriteMaterial).map?.dispose();
        pin.label.material.dispose();
      }
    }
    this.cube.geometry.dispose();
    if (this.cube.material instanceof THREE.Material) {
      this.cube.material.dispose();
    }
    this.renderer.dispose();
  }

  /**
   * The bottom-center label. Shows the matched preset's name whenever
   * the camera is exactly aligned to one of the six views — in either
   * projection mode, not just Orthographic — so clicking a pin always
   * updates the label to that view's name, whether or not the camera
   * happens to be in Perspective. Falls back to "Persp"/"Iso" (by
   * current projection) when unaligned.
   */
  private updateLabel(
    matched: ViewPreset | null,
    isOrthographic: boolean,
  ): void {
    let text: string;
    let icon: string;

    if (matched) {
      text = matched;
      icon = ICON_ALIGNED;
    } else {
      text = isOrthographic ? "Iso" : "Persp";
      icon = isOrthographic ? ICON_ISO : ICON_PERSPECTIVE;
    }

    if (text === this.lastLabelKey) return;
    this.lastLabelKey = text;
    this.labelElement.innerHTML = `${icon}<span>${text}</span>`;
  }

  /**
   * While the gizmo is unaligned (Iso, or an unaligned Perspective
   * view), all six pins show. Once the camera exactly matches a
   * preset, the two pins along the axis the camera is now looking
   * straight down (e.g. Top/Bottom when the matched view is "Top")
   * are hidden — they'd otherwise be foreshortened to a point behind
   * the cube anyway — leaving only the four pins that lie in the
   * plane perpendicular to that axis (e.g. Left/Right/Front/Back).
   */
  private updatePinVisibility(matched: ViewPreset | null): void {
    if (matched === this.lastMatched) return;
    this.lastMatched = matched;

    for (const pin of this.pins) {
      const visible =
        matched === null || !AXIS_PAIR[matched].includes(pin.preset);

      pin.cone.visible = visible;
      if (pin.label) pin.label.visible = visible;
    }
  }

  private buildCube(): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    const material = new THREE.MeshBasicMaterial({
      color: CUBE_COLOR,
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.Mesh(geometry, material);
  }

  private buildPins(): void {
    const axes: Array<{
      positivePreset: ViewPreset;
      negativePreset: ViewPreset;
      direction: THREE.Vector3;
      color: readonly [number, number, number];
      label: string;
    }> = [
      {
        positivePreset: "Right",
        negativePreset: "Left",
        direction: new THREE.Vector3(1, 0, 0),
        color: GRID_CONFIG.xAxisColor,
        label: "X",
      },
      {
        positivePreset: "Top",
        negativePreset: "Bottom",
        direction: new THREE.Vector3(0, 1, 0),
        color: Y_AXIS_COLOR,
        label: "Y",
      },
      {
        positivePreset: "Front",
        negativePreset: "Back",
        direction: new THREE.Vector3(0, 0, 1),
        color: GRID_CONFIG.zAxisColor,
        label: "Z",
      },
    ];

    for (const axis of axes) {
      this.addPin(
        axis.positivePreset,
        axis.direction,
        new THREE.Color(...axis.color),
        axis.label,
      );
      this.addPin(
        axis.negativePreset,
        axis.direction.clone().negate(),
        new THREE.Color(NEGATIVE_PIN_COLOR),
      );
    }
  }

  private addPin(
    preset: ViewPreset,
    direction: THREE.Vector3,
    color: THREE.Color,
    label?: string,
  ): void {
    // The pin head — a cone with its base at the rod's tip, pointing
    // further outward. A real 3D mesh rather than a billboarded
    // sprite so it actually reads as a pin (has a silhouette and
    // catches the widget's own rotation) rather than a flat knob.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(PIN_HEAD_RADIUS, PIN_HEAD_HEIGHT, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    cone.position
      .copy(direction)
      .multiplyScalar(/*ARM_LENGTH + */ PIN_HEAD_HEIGHT /* / 2*/);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
    this.root.add(cone);

    let labelSprite: THREE.Sprite | null = null;
    if (label) {
      labelSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: createLabelTexture(label) }),
      );
      labelSprite.scale.setScalar(LABEL_SCALE);
      labelSprite.position
        .copy(direction)
        .multiplyScalar(/*ARM_LENGTH + */ PIN_HEAD_HEIGHT + LABEL_GAP);
      this.root.add(labelSprite);
    }

    this.pins.push({ preset, cone, label: labelSprite });
  }

  private pointerToNdc(event: MouseEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector2(x, y);
  }

  /**
   * Raycasts against the visible pins and the cube together,
   * returning whichever the pointer is over (pins take priority on
   * overlap, since they're the more common target and the smaller
   * hit area). Hidden pins (see updatePinVisibility) are excluded —
   * Three.js's raycaster ignores an object's .visible flag by
   * default, so this filters them out explicitly rather than relying
   * on that.
   */
  private pick(event: MouseEvent): Pin | "cube" | null {
    const ndc = this.pointerToNdc(event);
    this.raycaster.setFromCamera(ndc, this.camera);

    const visiblePins = this.pins.filter((p) => p.cone.visible);
    const pinHits = this.raycaster.intersectObjects(
      visiblePins.map((p) => p.cone),
      false,
    );
    if (pinHits.length > 0) {
      return visiblePins.find((p) => p.cone === pinHits[0].object) ?? null;
    }

    const cubeHits = this.raycaster.intersectObject(this.cube, false);
    if (cubeHits.length > 0) return "cube";

    return null;
  }

  private setHovered(hit: Pin | "cube" | null): void {
    const nextCone = hit && hit !== "cube" ? hit.cone : null;
    const nextIsCube = hit === "cube";

    if (nextCone === this.hoveredCone && nextIsCube === this.hoveredCube)
      return;

    if (this.hoveredCone) {
      (
        this.hoveredCone.material as THREE.MeshBasicMaterial
      ).color.multiplyScalar(1 / HOVER_BRIGHTEN);
    }
    if (this.hoveredCube) {
      (this.cube.material as THREE.MeshBasicMaterial).color.multiplyScalar(
        1 / HOVER_BRIGHTEN,
      );
    }

    if (nextCone) {
      (nextCone.material as THREE.MeshBasicMaterial).color.multiplyScalar(
        HOVER_BRIGHTEN,
      );
    }
    if (nextIsCube) {
      (this.cube.material as THREE.MeshBasicMaterial).color.multiplyScalar(
        HOVER_BRIGHTEN,
      );
    }

    this.hoveredCone = nextCone;
    this.hoveredCube = nextIsCube;
    this.canvas.style.cursor = hit ? "pointer" : "default";
  }

  private onClick = (event: MouseEvent): void => {
    const hit = this.pick(event);
    if (hit === "cube") {
      this.onToggleProjection?.();
    } else if (hit) {
      this.onPresetSelected?.(hit.preset);
    }
  };

  private onMouseMove = (event: MouseEvent): void => {
    this.setHovered(this.pick(event));
  };
}
