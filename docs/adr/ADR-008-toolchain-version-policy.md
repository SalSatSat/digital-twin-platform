# ADR-008: Toolchain Version Policy

## Status
Accepted

## Date
2026-06-06

## Context
The platform depends on five toolchains — Rust, wasm-pack, Go, Node.js, and
pnpm — each with their own release cadences. Without a deliberate versioning
policy, toolchain versions drift between developers and CI environments,
producing subtle and hard-to-diagnose bugs.

## Decision
All toolchain versions are pinned explicitly in a single `.toolchain-versions`
file at the repository root. This file is the sole source of truth for
toolchain versions across the Dockerfile, devcontainer, and Makefile. Versions
are set to the current stable or active LTS release at the time of the
decision. Any toolchain upgrade requires a pull request that updates
`.toolchain-versions`, rebuilds the devcontainer, verifies all tests pass,
and is reviewed before merging.

## Reasoning
Floating versions such as latest produce non-reproducible environments.
A developer who rebuilds their container six months after the initial setup
should get the same toolchain versions as the original setup, not whatever
happened to be latest at rebuild time. Pinning in one file rather than
scattering version strings across multiple configuration files ensures there
is never ambiguity about which version is authoritative. The upgrade policy
makes toolchain bumps a deliberate, reviewed decision rather than an
accidental side effect of a container rebuild.

## Consequences
- All developers and CI environments run identical toolchain versions
- Toolchain upgrades are explicit, deliberate, and reviewable
- The devcontainer must be rebuilt whenever .toolchain-versions changes
- Versions will become outdated over time and require periodic review
- The current pinned versions are: Rust 1.95.0, wasm-pack 0.13.1,
  Go 1.26.4, Node.js 24.15.0, pnpm 11.5.2
