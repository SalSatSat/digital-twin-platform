# ADR-014: pnpm Workspace Linking Strategy

## Status
Accepted

## Date
2026-06-19

## Context
The platform has two different kinds of internal dependencies that needed
to be linked together during development: the WASM build output from
engine/wasm/pkg, which is not a pnpm workspace member, and client/renderer,
which is a pnpm workspace member consumed by client/app.

## Decision
We use a file: dependency to link the WASM package output into
client/renderer, and the workspace:* protocol to link client/renderer into
client/app.

## Reasoning
engine/wasm/pkg is generated build output from wasm-pack, not a source
package that lives in our pnpm-workspace.yaml. A file: dependency points
pnpm directly at that output directory, so client/renderer always picks up
the latest WASM build without a manual copy step. This keeps the Rust to
JavaScript boundary fast to iterate on — rebuild the WASM package, the
renderer sees the change immediately.

client/renderer, in contrast, is a proper workspace member with its own
package.json and source. workspace:* is the correct protocol for this case
— it tells pnpm to always resolve to the local workspace version rather than
attempting to fetch from a registry, and it avoids the need to manually keep
a version number in sync between the two packages during active development.

## Consequences
- Changes to engine/wasm require an explicit wasm-pack build before
  client/renderer sees them — there is no automatic file watching across
  this boundary yet
- Changes to client/renderer/src are reflected immediately in client/app
  because pnpm symlinks workspace packages rather than copying them
- engine/wasm/pkg remains gitignored, consistent with it being build output,
  meaning a fresh clone of the repository requires running wasm-pack build
  before client/renderer's file: dependency resolves correctly
- This linking strategy will need revisiting if/when the WASM package is
  published or versioned independently rather than always being built
  from source
