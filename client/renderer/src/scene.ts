/**
 * Describes a light source in the scene.
 * Lights are Three.js concerns — they don't exist in the ECS.
 */
export interface LightDefinition {
  type: "directional" | "ambient" | "point";
  color: number;
  intensity: number;
  position?: { x: number; y: number; z: number };
}

/**
 * Describes a camera entity to spawn in the scene.
 */
export interface CameraDefinition {
  name: string;
  position: { x: number; y: number; z: number };
  context: "Editor" | "Runtime" | "Universal";
  isActive?: boolean;
}

/**
 * Describes a dynamic entity to spawn in the scene.
 * Dynamic entities have both position and velocity.
 */
export interface DynamicEntityDefinition {
  name: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  color: number;
}

/**
 * Describes a static entity to spawn in the scene.
 * Static entities have position only.
 */
export interface StaticEntityDefinition {
  name: string;
  position: { x: number; y: number; z: number };
  color: number;
}

/**
 * The complete definition of a scene.
 *
 * A Scene describes what cameras, lights, and entities exist.
 * It does not own any runtime state — it is a pure description
 * that the SceneManager uses to set up the Engine and Renderer.
 */
export interface SceneDefinition {
  /** Human-readable name shown in the editor. */
  name: string;

  /** Optional description of the scene's purpose. */
  description?: string;

  /** Camera entities to spawn. */
  cameras: CameraDefinition[];

  /** Lights to add to the Three.js scene. */
  lights: LightDefinition[];

  /** Dynamic entities to spawn (have velocity). */
  dynamicEntities: DynamicEntityDefinition[];

  /** Static entities to spawn (no velocity). */
  staticEntities: StaticEntityDefinition[];
}

/**
 * The default scene — used as the initial scene when the platform loads.
 *
 * Contains a Scene Camera for editor navigation, a Runtime Camera
 * for the deployed experience, basic lighting, and three demo
 * entities to demonstrate multiple entity support.
 *
 * This scene is temporary — it will be replaced by a proper
 * scene loading system in a future phase.
 */
export const DEFAULT_SCENE: SceneDefinition = {
  name: "Default Scene",
  description: "The default scene loaded on platform startup.",

  cameras: [
    {
      name: "Scene Camera",
      position: { x: 0.0, y: 2.0, z: 10.0 },
      context: "Editor",
      isActive: true,
    },
    {
      name: "Runtime Camera",
      position: { x: 0.0, y: 5.0, z: 15.0 },
      context: "Runtime",
      isActive: false,
    },
  ],

  lights: [
    {
      type: "directional",
      color: 0xffffff,
      intensity: 1.0,
      position: { x: 5, y: 5, z: 5 },
    },
    {
      type: "ambient",
      color: 0x404040,
      intensity: 1.0,
    },
  ],

  dynamicEntities: [
    {
      name: "Cube A",
      position: { x: -3.0, y: 1.5, z: 0.0 },
      velocity: { x: 1.0, y: 0.0, z: 0.0 },
      color: 0x4f9eed,
    },
    {
      name: "Cube B",
      position: { x: -3.0, y: 0.0, z: 0.0 },
      velocity: { x: 1.5, y: 0.0, z: 0.0 },
      color: 0x48bb78,
    },
    {
      name: "Cube C",
      position: { x: -3.0, y: -1.5, z: 0.0 },
      velocity: { x: 0.8, y: 0.0, z: 0.0 },
      color: 0xf6ad55,
    },
  ],

  staticEntities: [
    {
      name: "Cube D",
      position: { x: -3.0, y: 3.0, z: 0.0 },
      color: 0xffffff,
    },
  ],
};
