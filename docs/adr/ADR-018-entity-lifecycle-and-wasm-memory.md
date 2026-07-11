# ADR-018: Entity Lifecycle and WASM Memory Management

## Status
Accepted

## Date
2026-07-11

## Context
Phase 8 introduced multiple entities and exposed a critical issue: WASM linear
memory exhausted after approximately 600 ticks when entities carried
heap-allocated components (String, Vec<String>, Vec<Entity> from EntityInfo
and HierarchyNode introduced in Phase 7). Entities were spawned once and
ticked indefinitely with no despawn path, causing the WASM heap to grow
monotonically until the runtime ran out of memory.

A secondary issue was React Strict Mode double-invoking useEffect in
development, creating two Engine instances simultaneously and doubling memory
pressure, causing crashes within 100 ticks.

## Decision
We introduced proper entity lifecycle management: a Vec<Option<Entity>> handle
store with slot reuse, a despawn_entity() method on EngineWorld, a boundary
check in the render loop that despawns entities crossing the visible area and
respawns them at the starting position, and removal of React Strict Mode in
development.

## Reasoning

### Vec<Option<Entity>> with slot reuse
The original Vec<Entity> had no despawn path — handles were indices into a
Vec that only grew. Changing to Vec<Option<Entity>> allows slots to be set
to None when an entity is despawned and reused by new spawns. This bounds
memory growth — the Vec only grows when more entities exist simultaneously
than ever before, not with every spawn.

### despawn_entity() on EngineWorld
Calling world.despawn(entity) in hecs removes the entity and drops all its
components, including heap-allocated String and Vec fields. The WASM allocator
reclaims that memory. Without this call, memory grew regardless of what the
renderer did. This is the actual fix — the boundary respawn logic is what
triggers it at the right time.

### Boundary despawn/respawn in the render loop
Entities that cross BOUNDARY_X are despawned and new entities are spawned at
SPAWN_X. This keeps the entity count constant and memory bounded. The velocity
for respawned entities is currently estimated from position delta, which is
imprecise. The original velocity will be stored and reused when proper scene
management is introduced in a later phase.

### React Strict Mode removal
React Strict Mode intentionally double-invokes effects in development to
surface bugs. With a WASM engine that owns significant memory, double
invocation creates two Engine instances running simultaneously, doubling
memory pressure. Removing Strict Mode ensures a single Engine instance exists
at all times. The consequence is that React lifecycle bugs that Strict Mode
would have caught are harder to detect in development. This is an acceptable
tradeoff until proper scene management in Phase 10 provides a more robust
solution.

## Consequences
- Entity handles are now Vec<Option<Entity>> indices — despawned slots are
  None and reused by new spawns
- WASM heap memory is bounded as long as entities are despawned when no
  longer needed — memory exhaustion will recur if entities are spawned
  without corresponding despawns
- The respawn velocity estimation is imprecise and will be replaced when
  entity state is stored explicitly in a scene management layer
- React Strict Mode is disabled in development — the app runs in the same
  mode in development and production, which reduces the gap between
  environments but removes a class of development-time checks
- The build-wasm Makefile target was added to reliably sync the compiled
  WASM binary to all consumer packages, addressing a gap where pnpm
  install --force updated JS files but not the WASM binary itself
