# ADR-005: Devcontainer Strategy

## Status
Accepted

## Date
2026-06-06

## Context
The platform requires three language toolchains — Rust with WebAssembly
support, Go, and Node.js with pnpm — plus associated tools like wasm-pack
and cargo-watch. Developers work on WSL2 with Docker Engine only, with no
Docker Desktop available. We needed a development environment strategy that
is reproducible, fast to rebuild, and requires no manual toolchain
installation.

## Decision
We use a single devcontainer for all developers, built on debian:bookworm-slim,
with all three toolchains installed in carefully ordered layers to maximize
cache efficiency.

## Reasoning
A single shared devcontainer was chosen over per-team containers because the
team is currently small, both teams occasionally need the full stack, and
multiple containers add coordination overhead that is not yet justified. The
alternative of asking developers to install toolchains locally was rejected
because it produces environment drift and requires significant manual setup.
debian:bookworm-slim was chosen over pre-baked Microsoft devcontainer images
because it gives full control over every installed component, produces a
smaller image, and makes failures easier to diagnose. Named Docker volumes
are used for Rust build artifacts, the Go module cache, and the pnpm store
to prevent cache loss on container rebuilds and avoid WSL2 filesystem
performance problems.

## Consequences
- New developers need only VSCode with the Dev Containers extension to get
  a fully working environment
- The devcontainer image is larger than a production image but optimized
  for rebuild speed via careful layer ordering
- Named volumes for build caches survive container rebuilds, making
  subsequent builds significantly faster
- The repository must live inside the WSL2 filesystem, not under /mnt/c/,
  for acceptable Rust compilation performance
- A single devcontainer means the engine team carries Node.js overhead and
  the web team carries Rust overhead — acceptable at current team size
