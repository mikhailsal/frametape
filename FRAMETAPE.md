# FrameTape — AI Debug Instrumentation System

> **For AI agents:** Read this file first. It tells you what FrameTape is, how to activate it, and the essential commands. For deeper details, follow the links to sub-documents.

## What Is FrameTape?

FrameTape is a JavaScript library (`frametape.js`) that gives AI agents **frame-by-frame control** over web applications. It solves the core problem: AI cannot normally "see" what happens between screenshots. FrameTape wraps `requestAnimationFrame` so you can **pause**, **step**, **slow down**, and **inspect** every single frame of a running web app.

**It exposes a single global API:** `window.__AI_DEBUG__`

## Quick Reference

| Goal | Command |
|---|---|
| Activate AI mode | `__AI_DEBUG__.setMode('ai')` |
| Pause everything | `__AI_DEBUG__.pause()` |
| Advance 1 frame | `__AI_DEBUG__.step(1)` |
| Resume normal play | `__AI_DEBUG__.resume()` |
| Slow to 2 FPS | `__AI_DEBUG__.setSlowMotion(2)` |
| Read app state | `__AI_DEBUG__.getState()` |
| Modify app state | `__AI_DEBUG__.setState({ score: 5 })` |
| Get recent frames | `__AI_DEBUG__.getLastFrames(10)` |
| Get event log | `__AI_DEBUG__.getEventLog(20)` |
| Check for errors | `__AI_DEBUG__.getErrors()` |
| Full status | `__AI_DEBUG__.getSummary()` |

## How to Activate

**Method 1 — URL parameter (recommended for browser tools):**
```
http://localhost:9090/index.html?debug=ai
```
The app auto-activates AI debug mode on load. A green debug panel appears on the right side.

**Method 2 — JavaScript injection:**
```javascript
window.__AI_DEBUG__.setMode('ai');
```

## Core Debugging Workflow

This is the standard procedure an AI agent should follow:

```
1. Navigate to the app URL with ?debug=ai
2. Inject JS or use keyboard to interact with the app
3. Pause:     __AI_DEBUG__.pause()
4. Inspect:   __AI_DEBUG__.getState()       → read current state
5. Step:      __AI_DEBUG__.step(1)           → advance exactly 1 frame
6. Inspect:   __AI_DEBUG__.getState()       → see what changed
7. Compare states to verify correctness
8. If needed: __AI_DEBUG__.setState({...})  → inject a specific state
9. Step again and observe
10. Resume:   __AI_DEBUG__.resume()          → return to normal execution
```

### When to Use Each Mode

- **Pause + Step** — Best for precise debugging. You control every frame. Use when you need to verify exact state transitions (e.g., "does the snake move exactly one cell right?").
- **Slow Motion** — Best for observing animations and visual behavior over time. Set `setSlowMotion(2)` for 2 FPS, which gives you time to take screenshots between frames.
- **Normal (resume)** — Use for smoke testing that the app runs without errors.

## Key Concepts

### FrameTape (Recording)
Every frame is recorded into a circular buffer (default: 500 frames). Each record contains:
- `frame` — frame number
- `timestamp` — high-resolution timestamp
- `duration` — time since previous frame
- `state` — deep copy of app state at that moment
- `events` — keyboard/mouse events that occurred during this frame
- `errors` — any JS errors caught during this frame
- `performance` — memory usage metrics

### Film Strip
If a canvas is registered, FrameTape captures thumbnail screenshots every frame into a circular buffer (default: 12 thumbnails). This gives you visual context of recent changes without needing external screenshots.

### Event Log
All keyboard, mouse, and touch events are automatically intercepted and logged with their frame number. Use `getEventLog()` to see what user input occurred and when.

### State Provider / Injector
The application registers two functions with FrameTape:
- **State Provider** — returns the current app state (called every frame for recording)
- **State Injector** — accepts a patch object to modify the app state (used by `setState()`)

This is what makes `getState()` and `setState()` work. Without registration, these return `null`.

### Seeded Random
For reproducible debugging, you can replace `Math.random` with a deterministic PRNG:
```javascript
__AI_DEBUG__.setRandomSeed(42);  // Now Math.random() is deterministic
__AI_DEBUG__.clearRandomSeed();  // Restore original Math.random
```

## Documentation Index

| File | Contents | When to Read |
|---|---|---|
| **[FRAMETAPE.md](FRAMETAPE.md)** | This file — overview and quickstart | Always read first |
| **[docs/api-reference.md](docs/api-reference.md)** | Complete API reference with all methods, parameters, and return values | When you need exact method signatures |
| **[docs/debugging-walkthrough.md](docs/debugging-walkthrough.md)** | Step-by-step example: debugging the Snake game, finding and fixing a real bug | When you want to learn the debugging methodology |
| **[docs/integration-guide.md](docs/integration-guide.md)** | How to instrument your own web application with FrameTape | When building or modifying an app to use FrameTape |

## Architecture at a Glance

```
┌────────────────────────────────────────────────────┐
│  Web Application (e.g., Snake Game)                │
│                                                    │
│  ┌──────────┐  registers  ┌─────────────────────┐  │
│  │  Canvas   │───────────▶│  frametape.js       │  │
│  └──────────┘             │  (FrameTape)        │  │
│  ┌──────────┐  registers  │                     │  │
│  │  State    │───────────▶│  window.__AI_DEBUG__│  │
│  └──────────┘             └────────┬────────────┘  │
│                                    │               │
│  requestAnimationFrame ◄───wrapped─┘               │
└────────────────────────────────────────────────────┘
                    │
          ┌─────────┴──────────┐
          │  AI Agent (you)    │
          │                    │
          │  • pause/step/run  │
          │  • getState()      │
          │  • setState()      │
          │  • getErrors()     │
          │  • screenshots     │
          └────────────────────┘
```

## File Structure

```
frametape/
├── frametape.js          ← FrameTape library (include BEFORE your app)
├── index.html           ← Snake game demo with FrameTape integration
├── FRAMETAPE.md         ← This file
└── docs/
    ├── api-reference.md
    ├── debugging-walkthrough.md
    └── integration-guide.md
```

## How FrameTape Compares

FrameTape is **not** a session replay tool, a browser extension, or a product analytics platform. It is a lightweight, AI-agent-first debugging instrument for live web applications.

Several existing projects overlap with parts of what FrameTape does, but none combines all of its features — and none targets AI agents as the primary user.

| Project | What It Does | Overlap with FrameTape | Key Difference |
|---|---|---|---|
| **[rrweb](https://github.com/rrweb-io/rrweb)** (19k+ stars) | Records & replays DOM mutations as JSON events | Event recording, canvas capture, playback speed control | Passive replay of past sessions — no live app control, no state access |
| **[Replay.io](https://replay.io)** | Time-travel debugger using a custom Chromium browser | Step through execution, inspect state, deterministic replay | Requires a special browser + cloud platform; human-oriented GUI |
| **[Reactime](https://reactime.io)** (2k+ stars) | Chrome extension for React state snapshots & time travel | State recording, snapshot jumping, debug panel | React-only, Chrome extension, no frame-level control |
| **[rafps](https://github.com/lukeed/rafps)** (82 stars) | Tiny helper for rAF play/pause/FPS control | rAF wrapping, play/pause, FPS targeting | Only frame rate control — no state, events, errors, or recording |
| **[OpenReplay](https://openreplay.com)** (11k+ stars) | Self-hosted session replay & product analytics | Error capture, event recording, canvas support | Full platform for human product teams — no live control, no state API |

### What makes FrameTape unique

- **AI-agent-first** — a single `window.__AI_DEBUG__` API callable via `evaluate()` from any browser automation tool
- **Live control** — pause, step, and slow-motion the running app (not a post-hoc recording)
- **State read/write** — get and modify application state mid-execution
- **All-in-one** — frame control + state tape + event log + error capture + canvas film strip
- **Zero dependencies** — single ~660-line JS file, drop-in `<script>` tag

| Feature | FrameTape | rrweb | Replay.io | Reactime | rafps | OpenReplay |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **rAF pause/step/resume** | ✅ | ❌ | ❌ | ❌ | ✅ (play/pause) | ❌ |
| **Slow motion control** | ✅ | ✅ (playback) | ❌ | ❌ | ✅ | ✅ (playback) |
| **App state get/set** | ✅ | ❌ | ❌ (read only) | ✅ (React only) | ❌ | ❌ |
| **Per-frame state recording** | ✅ | ❌ | ✅ | ✅ (on change) | ❌ | ❌ |
| **Event recording** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Error capture** | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **Canvas film strip** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Seeded RNG** | ✅ | ❌ | ✅ (system-level) | ❌ | ❌ | ❌ |
| **Debug panel overlay** | ✅ | ❌ | ❌ | ✅ (Chrome ext) | ❌ | ❌ |
| **AI-agent API** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Framework-agnostic** | ✅ | ✅ | ✅ | ❌ (React) | ✅ | ✅ |
| **Zero dependencies** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Single file** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Live app control** | ✅ | ❌ | ❌ | ❌ | ✅ (partial) | ❌ |
| **Stars** | New | 19.1k | N/A (SaaS) | 2.2k | 82 | 11.7k |