# ADR-025: Pin wasm-bindgen to 0.2.125 (not 0.2.100)

## Status

Accepted

## Context

During Phase 13 (Runtime Editor) development, the browser began failing to
instantiate the compiled WASM module with:

```
Uncaught (in promise) LinkError: WebAssembly.instantiate(): Import #3
"./dt_engine_wasm_bg.js" "__wbindgen_cast_0000000000000001": function
import requires a callable
```

This surfaced while building the Inspector's component reflection layer
(`reflection.rs`), and was initially assumed to be caused by that new code
— either the `serde_json` (de)serialization involved, or something about
the `ComponentDescriptor` function-pointer table. A prior session spent
significant time bisecting `wasm-bindgen` versions (0.2.125, 0.2.126,
0.2.100) while reflection.rs was present, without reaching a conclusion,
and left `wasm-bindgen` pinned to `=0.2.100` in `engine/wasm/Cargo.toml`.

A follow-up session confirmed the pin was the actual root cause, unrelated
to reflection.rs, via isolation testing:

- With `reflection.rs` completely removed from the build (no `mod
  reflection;`, no reflectable methods on `EngineWorld`) and
  `wasm-bindgen = "=0.2.100"`, the identical `LinkError` still occurred.
- A fresh worktree checked out at the last commit before reflection work
  began (`925e38e`, which used unpinned `wasm-bindgen = "0.2.122"`,
  resolving to `0.2.125` in that worktree's lock file) built and
  instantiated cleanly in the browser.
- Re-pinning current `dev` to `wasm-bindgen = "=0.2.125"`, with
  reflection.rs still disabled, also instantiated cleanly.
- Restoring reflection.rs on top of `0.2.125` instantiated cleanly and the
  reflection API (`list_components`, etc.) worked correctly end-to-end in
  the browser.

This isolates the cause precisely: `0.2.100` is genuinely older than any
version this project has used since Phase 12 (`0.2.122+`), and is
incompatible with something in the compiled output requiring a
`__wbindgen_cast_*` runtime shim that `0.2.100`'s CLI does not generate.
`0.2.100` was never a "known-good" version to revert to — it was, in
effect, a downgrade below the project's actual working floor, introduced
during bisection under the (reasonable, but incorrect) assumption that an
older version would be safer.

Three unrelated issues complicated this investigation and are documented
here so they aren't mistaken for part of the root cause on a future read:

1. A stale `git worktree` at `/tmp/pre-phase13-check` (left over from the
   prior session's bisection) had its own `vite` dev server still running
   in the background, silently serving stale build output to the browser
   for part of this session.
2. The project has two separate Vite instances/caches
   (`client/renderer/node_modules/.vite` and
   `client/app/node_modules/.vite`); the actual running dev server reads
   from `client/app`, not `client/renderer`. Clearing the wrong one
   produces a false "still broken" result even after a genuinely correct
   fix.
3. A `cargo`/`wasm-pack` incremental-build cache once failed to detect a
   source change (removing a temporary test method) and produced a
   byte-identical stale artifact despite reporting a "finished" build in
   under 1 second — confirmed via `grep` on the generated JS glue for the
   removed symbol, and resolved with `cargo clean -p dt-engine-wasm`.

## Decision

Pin `wasm-bindgen = "=0.2.125"` in `engine/wasm/Cargo.toml`.

Confirmed working range for this project, as of this investigation:
**0.2.122–0.2.126**. `0.2.100` is confirmed broken and must not be
reintroduced without a documented, browser-verified reason.

## Consequences

- The reflection layer (`reflection.rs`) and all `EngineWorld` methods
  work correctly in the browser on `0.2.125`.
- Any future `wasm-bindgen` version change (whether pinning to a specific
  patch or widening the requirement) must be followed, in the same
  session, by: a clean rebuild (`cargo clean -p dt-engine-wasm` if in
  doubt about incremental caching), a full force-sync of `.js`/`.d.ts`/
  `.wasm` into `client/renderer/node_modules/dt-engine-wasm`, a clear of
  `client/app/node_modules/.vite` (the directory the dev server actually
  reads from), a full stop/restart of `make dev-client` (not just a
  cache clear or hard refresh), and an actual browser instantiation
  check — ideally exercising at least one method that crosses the WASM
  boundary with a non-trivial return type, not just constructing
  `EngineWorld`.
- No automated regression test currently catches a broken `wasm-bindgen`
  pin before it reaches manual browser testing. See Outstanding Technical
  Debt in the accompanying session HANDOFF for a proposed headless-browser
  smoke test.

## Alternatives Considered

- **Leave `wasm-bindgen` unpinned (`"0.2"` or similar range)**, as it was
  before Phase 13. This would have avoided the specific regression here,
  but an unpinned range can still drift to a new version that introduces
  its own incompatibility without warning. A pin is still preferable in
  principle — the problem was pinning to the wrong version, not pinning
  itself.
- **Continue bisecting further versions (0.2.101–0.2.121) to find the
  exact minimum working version.** Not done — 0.2.125 is already
  confirmed to match what Phase 12 used and work correctly, and there's
  no concrete benefit to finding a lower floor versus the cost of further
  bisection.

## Should this remain unchanged?

Yes. `0.2.125` should be treated as the current known-good pin. Do not
change it without repeating the full verification sequence described
above in the same session as the change.
