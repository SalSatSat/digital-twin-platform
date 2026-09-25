# ADR-033: Editor Selection State — Ownership, Shape, and Multi-Select

## Status
Accepted

## Date
2026-09-25

## Context
Before Phase 17, selection was a bare `App.tsx` `useState<number | null>`
fed only by `EntityHierarchyPanel` row clicks — there was no way to select
an entity from the 3D viewport itself, and no ADR recorded where selection
should live or how it should be shaped; ADR-026 covers the Hierarchy panel
itself, and ADR-029 covers Editor/Runtime *camera* context selection, a
different concept. Phase 17 needed to add viewport click-to-select, and
Phases 18 (outline) and 19 (transform gizmo) both need a selection model
that already supports more than one entity, so the shape had to be
settled now rather than revisited per-phase.

## Decision
Picking is an **entity-mesh-only CPU raycast**: `SceneManager.pickEntity`
casts a `THREE.Raycaster` against `spawnedEntities`' meshes (filtered on
`mesh.visible`) and returns an ECS handle or `null`. No Rust change was
needed or made.

Picking is **edit-mode only**, gated inside `Renderer`. A left
`mousedown` (button 0, no Alt) arms a pick candidate and records its
position; `mouseup` fires the pick only if edit mode is on and the
squared pointer displacement stayed under a 4px threshold — otherwise
it's treated as a drag. This runs alongside `CameraControls` without
interference: Alt-left-orbit, right-mouse-fly, and middle-mouse-pan never
arm a pick candidate in the first place.

Selection state — `{ handles: readonly number[]; primary: number | null }`
— is **owned by `App` (React), not the ECS or the Renderer**. It's
editor/UI state, not simulation data. A pure module, `client/app/src/selection.ts`
(`select`, `toggle`, `clear`, `prune`), is shared by both the viewport
(via `EngineView`'s `onEntityPicked`) and the Hierarchy panel's row
clicks, so the two input surfaces can't diverge in semantics.

Multi-select is **"C-lite"**: Ctrl/Cmd-click toggles a handle in or out
of the set; toggling one on makes it primary; toggling off the primary
promotes the most recently added remaining handle. Ctrl/Cmd-click on
empty viewport space is a no-op; a plain click on empty space clears the
whole selection. `primary` is the one handle the Inspector displays —
multi-edit is out of scope for this phase. Shift-range-select,
multi-drag, and multi-edit are explicitly deferred (see the handoff's
Outstanding Technical Debt).

Selection is **pruned** against `engine.listComponents(handle).length > 0`
whenever edit mode is (re-)entered: from the "Enter Editor" click, from a
`popstate`-driven navigation to `/editor`, and from a stable-identity
`onEngineReady` callback (covering an Engine remount under StrictMode or
HMR). Pruning is *not* done in a bare `useEffect` reacting to
`[engine, isEditMode]` — that pattern was tried first and rejected (see
Reasoning).

## Reasoning
CPU raycast against Three.js meshes was chosen over a Rust-side query
because click accuracy doesn't need ECS-authoritative state — the meshes
already mirror ECS world position every frame — and at the current scale
(box meshes, tens of entities) a per-click `Raycaster` call is
negligible. A Rust-side BVH shared with future collision detection is a
plausible later optimization if GLB models (Phase 21) make CPU
raycasting a bottleneck, but the `pickEntity(ndc, camera): number | null`
contract doesn't change either way, so nothing here blocks that path.

App ownership (over Renderer- or ECS-owned selection) keeps the ECS the
source of truth for simulation data only, keeps selection naturally
reactive to React re-renders (Inspector, Hierarchy), and avoids
pre-building a second, throwaway "selection" concept in Rust before
Phase 20's Event Bus can introduce `OnEntitySelected` properly.

A shared `selection.ts` over duplicating toggle/promote logic in both
`EngineView` and `EntityHierarchyPanel` guarantees the two entry points
can't drift apart. Its semantics were modeled on Unity's own
Scene-view/Hierarchy selection behavior as closely as could be confirmed
without a Unity install available this session — Shift-click and
Shift-range-select intentionally were not attempted from memory and are
deferred rather than guessed at.

Deferring the `setSelection` push (an outline-consuming shape, e.g. a
list of Object3D references) to Phase 18: nothing in Phase 17 consumes
it, and its shape should be dictated by what the outline pass actually
needs, not guessed now.

Effect-driven pruning (`useEffect(() => setSelection(prune(...)),
[engine, isEditMode])`) was the first approach tried during
implementation and was rejected — not just as a style preference, but
because it triggered a lint failure (`react-hooks` flagging synchronous
`setState` in an effect body as an anti-pattern that risks cascading
renders). The fix moved each prune call to the actual interaction that
causes edit mode to become true, which also surfaced a second, related
constraint: `EngineView`'s Engine/Renderer setup effect depends on
`onEngineReady`'s referential identity, so the wrapper callback needed to
be `useCallback`-memoized with an empty dependency array, reading
`isEditMode` through a ref rather than closing over it directly.

## Consequences
Enables viewport click-to-select with full parity between the viewport
and the Hierarchy panel, and a multi-select foundation Phases 18 and 19
can consume directly (`selection.handles` for multi-entity outline
highlighting, `selection.primary` as the transform gizmo's attach
target) without a selection-model redesign.

Constrains: any future selection input surface (a Console log entry, an
asset-browser row) must reuse `selection.ts`'s `select`/`toggle`/`clear`/
`prune` rather than inventing parallel transitions. A future need for an
*engine-side* selection concept (server-persisted selection, physics-side
picking) is a different data flow — Phase 20's Event Bus — and should not
be retrofitted onto this client-only React state. `App`'s `onEngineReady`
must remain referentially stable (`useCallback` with `[]` deps) for as
long as `EngineView`'s setup effect depends on it; any future change to
that effect's dependencies should revisit this constraint rather than
silently breaking it.
