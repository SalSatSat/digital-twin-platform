# syntax=docker/dockerfile:1

# ── Zone 1: Base ──────────────────────────────────────────────────────────────
# We use debian:bookworm-slim because:
# - Predictable, minimal, long support horizon
# - No pre-baked toolchains we didn't ask for
# - Small base means faster pulls
FROM debian:bookworm-slim

# Declare build args — values are passed in from devcontainer.json
# These map directly to our .toolchain-versions file
ARG RUST_VERSION
ARG WASM_PACK_VERSION
ARG GO_VERSION
ARG NODE_VERSION
ARG PNPM_VERSION

# ── Zone 1: System packages ───────────────────────────────────────────────────
# These are the low-level tools every language toolchain depends on.
# We install these first because they almost never change.
# If this layer is cached, it never rebuilds regardless of toolchain changes.
#
# curl         — downloading toolchain installers
# git          — source control inside the container
# ca-certificates — HTTPS certificate validation (needed for curl)
# build-essential — C compiler + make (some Rust crates compile C dependencies)
# pkg-config   — helps Rust find system libraries
# libssl-dev   — SSL development headers (needed by some Rust/Go packages)
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Zone 1: Non-root user ─────────────────────────────────────────────────────
# We create a non-root user named "developer" with UID/GID 1000.
#
# Why non-root?
# - Rust and Go toolchains install into user home directories, not system dirs
# - Files created inside the container will have correct ownership on WSL2
# - It's a basic security practice worth establishing from day one
#
# Why UID 1000?
# - This matches the default UID of the first user in most Linux systems
# - Including WSL2 — so file ownership between host and container aligns
RUN groupadd --gid 1000 developer \
    && useradd --uid 1000 --gid 1000 --shell /bin/bash --create-home developer

# All subsequent steps run as the developer user
USER developer
WORKDIR /home/developer

# ── Zone 2a: Rust ─────────────────────────────────────────────────────────────
# We install Rust via rustup — the official Rust toolchain manager.
#
# Why rustup and not apt?
# - apt's Rust package lags behind significantly
# - rustup lets us pin an exact version and switch channels
# - rustup is how the entire Rust ecosystem expects Rust to be installed
#
# RUSTUP_HOME — where rustup stores toolchain metadata
# CARGO_HOME  — where cargo (Rust's package manager) stores binaries and cache
# We set these explicitly so they're predictable and can be volume-mounted later
ENV RUSTUP_HOME=/home/developer/.rustup
ENV CARGO_HOME=/home/developer/.cargo
ENV PATH=/home/developer/.cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --default-toolchain ${RUST_VERSION} \
    # wasm32-unknown-unknown is the compilation target for WebAssembly
    # "unknown-unknown" means: not tied to any specific OS or environment
    # This is what lets Rust code run in a browser
    && rustup target add wasm32-unknown-unknown

# ── Zone 2b: wasm-pack ────────────────────────────────────────────────────────
# wasm-pack is the tool that compiles Rust to WASM and generates
# the JavaScript bindings that let us call Rust functions from JS.
#
# Think of it as the "build pipeline" between your Rust engine and the browser.
#
# We install via the binary installer, NOT via "cargo install wasm-pack".
# cargo install compiles from source — that takes 10+ minutes.
# The binary installer downloads a pre-compiled executable — takes seconds.
RUN curl -sSf https://github.com/rustwasm/wasm-pack/releases/download/v${WASM_PACK_VERSION}/wasm-pack-init.sh \
    | sh

# ── Zone 2c: Go ───────────────────────────────────────────────────────────────
# We install Go via the official tarball, not apt.
# apt's Go package often lags by several minor versions.
#
# Go installs to /usr/local/go (system level) but we download as the developer
# user and use sudo-equivalent via the tarball approach.
# Instead, we install to the user's home directory to stay consistent
# with our non-root approach.
ENV GOROOT=/home/developer/.go
ENV GOPATH=/home/developer/go
ENV PATH=/home/developer/.go/bin:/home/developer/go/bin:$PATH

RUN curl -sSL https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz \
    | tar -xz -C /home/developer/ \
    && mv /home/developer/go /home/developer/.go

# ── Zone 2d: Node + pnpm ──────────────────────────────────────────────────────
# We install Node via the official binary tarball.
# This gives us exact version control without relying on apt or nvm.
#
# Why not nvm?
# nvm is a shell function, not a binary — it's designed for interactive
# developer shells, not containers. It adds complexity with no benefit here.
#
# pnpm is installed via corepack — Node's built-in package manager manager.
# corepack reads the version we specify and downloads the correct pnpm binary.
ENV NODE_HOME=/home/developer/.node
ENV PATH=/home/developer/.node/bin:$PATH

RUN curl -sSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
    | tar -xJ -C /home/developer/ \
    && mv /home/developer/node-v${NODE_VERSION}-linux-x64 /home/developer/.node \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate

# ── Zone 3: Global development tooling ───────────────────────────────────────
# cargo-watch watches your Rust source files and re-runs a command when
# they change. The equivalent of Unity's automatic recompile on save.
# We install this now so it's always available without waiting.
RUN . $HOME/.cargo/env && cargo install cargo-watch

# ── Final environment ─────────────────────────────────────────────────────────
# Set the working directory to where the repo will be mounted
WORKDIR /workspaces/digital-twin-platform

# Verify all toolchains are reachable — this line fails the build
# loudly if any tool is missing, rather than silently producing
# a broken container
RUN . $HOME/.cargo/env \
    && rustc --version \
    && cargo --version \
    && wasm-pack --version \
    && go version \
    && node --version \
    && pnpm --version
