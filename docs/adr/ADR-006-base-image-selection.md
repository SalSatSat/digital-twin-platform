# ADR-006: Base Image Selection

## Status
Accepted

## Date
2026-06-06

## Context
The devcontainer Dockerfile needs a base Linux image. The two realistic
options were debian:bookworm-slim and the pre-baked Microsoft devcontainer
base images such as mcr.microsoft.com/devcontainers/base:ubuntu. We needed
to choose one before writing the Dockerfile.

## Decision
We use debian:bookworm-slim as the base image for the devcontainer.

## Reasoning
The pre-baked Microsoft devcontainer images include tooling and conveniences
designed to reduce setup friction for beginners. This platform has specific,
pinned toolchain version requirements that conflict with pre-baked
assumptions. debian:bookworm-slim gives complete control over every installed
component, produces a leaner image, and makes the build process fully
transparent — every installed tool is explicitly declared in the Dockerfile.
When something breaks, the cause is identifiable because nothing was
installed implicitly. Debian Bookworm is the current stable release with a
long support horizon, making it a safe long-term foundation.

## Consequences
- Every system dependency must be explicitly declared in the Dockerfile
- The image is smaller and more predictable than pre-baked alternatives
- Debugging environment issues is straightforward because the full
  installation is visible in one file
- Upgrading the base image requires a deliberate decision rather than
  happening implicitly
- No pre-baked VSCode server tooling — the devcontainer extension handles
  this automatically regardless of base image
