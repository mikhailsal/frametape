# Integration Guide: Adding FrameTape to Your Web Application

> How to instrument any web application with FrameTape so AI agents can debug it. See [FRAMETAPE.md](../FRAMETAPE.md) for overview | [API Reference](api-reference.md) for method details.

---

## Minimal Integration (3 Steps)

### Step 1: Include the Library

Add `frametape.js` **before** your application script:

```html
<script src="frametape.js"></script>
<script src="your-app.js"></script>
```

**Why before?** FrameTape wraps `requestAnimationFrame` and `EventTarget.prototype.addEventListener` on load. Your app must call the wrapped versions, not the originals.

### Step 2: Register a State Provider

In your application code, after your state is initialized:

```javascript
if (window.__AI_DEBUG__) {
  window.__AI_DEBUG__.registerStateProvider(
    function () { return myAppState; },       // getter: returns current state
    function (patch) {                         // setter: merges patch into state
      Object.assign(myAppState, patch);
    }
  );
}
```

**Requirements for the state object:**
- Must be **JSON-serializable** (no functions, DOM elements, circular references)
- Should contain all meaningful application state (position, score, game phase, etc.)
- The getter is called every frame, so it should be fast

### Step 3: Auto-Activate via URL Parameter

Add this after registration:

```javascript
if (window.__AI_DEBUG__) {
  if (new URLSearchParams(window.location.search).get('debug') === 'ai') {
    window.__AI_DEBUG__.setMode('ai');
  }
}
```

Now AI agents can activate debug mode by navigating to `yourapp.html?debug=ai`.

**That's it for basic integration.** The AI can now pause, step, read state, and modify state.

---

## Optional: Register a Canvas

If your app renders to a `<canvas>`, register it for film strip capture:

```javascript
if (window.__AI_DEBUG__) {
  window.__AI_DEBUG__.registerCanvas(document.getElementById('my-canvas'));
}
```

This enables the film strip — frame-by-frame thumbnails visible in the debug panel.

---

## State Injector: Handling Complex State

The basic `Object.assign` setter works for flat state. For nested objects (arrays, sub-objects), you need a smarter injector to avoid reference issues:

```javascript
window.__AI_DEBUG__.registerStateProvider(
  function () { return state; },
  function (patch) {
    if (!patch) return;
    Object.keys(patch).forEach(function (key) {
      if (Array.isArray(patch[key]) || typeof patch[key] === 'object') {
        // Deep copy complex values to avoid shared references
        state[key] = JSON.parse(JSON.stringify(patch[key]));
      } else {
        state[key] = patch[key];
      }
    });
  }
);
```

This ensures that when AI calls `setState({ snake: [...] })`, the injected array is a fresh copy, not a reference to the patch object.

---

## Architecture Recommendations

### Centralized State

FrameTape works best when your app has a **single state object** that represents everything:

```javascript
// ✅ Good — single centralized state
const state = {
  player: { x: 0, y: 0, health: 100 },
  enemies: [...],
  score: 0,
  level: 1,
  phase: 'playing'
};

// ❌ Bad — scattered state across many variables
let playerX = 0;
let playerY = 0;
let health = 100;
let score = 0;
```

With centralized state, `getState()` returns everything, and `setState()` can modify anything.

### Use requestAnimationFrame

FrameTape wraps `requestAnimationFrame`. If your app uses `setInterval` or `setTimeout` for its main loop, FrameTape's pause/step won't control it. Convert to rAF:

```javascript
// ❌ Won't be controlled by FrameTape
setInterval(gameLoop, 16);

// ✅ Controlled by FrameTape
function gameLoop(timestamp) {
  update();
  render();
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
```

### Keep Rendering Deterministic

If `render()` depends only on `state`, then stepping through frames produces predictable visual output. Avoid rendering based on wall-clock time or random values (unless using `setRandomSeed()`).

---

## Full Integration Example (Snake Game Pattern)

Here's the complete integration pattern from the Snake game:

```javascript
// === At the end of your app's initialization ===

if (window.__AI_DEBUG__) {
  // 1. Register state provider with deep-copy injector
  window.__AI_DEBUG__.registerStateProvider(
    function () { return state; },
    function (patch) {
      if (patch) {
        Object.keys(patch).forEach(function (key) {
          if (key === 'snake' || key === 'food') {
            state[key] = JSON.parse(JSON.stringify(patch[key]));
          } else {
            state[key] = patch[key];
          }
        });
      }
    }
  );

  // 2. Register canvas for film strip
  window.__AI_DEBUG__.registerCanvas(canvas);

  // 3. Log registration for debugging
  console.log('App registered with FrameTape');

  // 4. Auto-activate AI debug mode via URL parameter
  if (new URLSearchParams(window.location.search).get('debug') === 'ai') {
    window.__AI_DEBUG__.setMode('ai');
    console.log('AI Debug Mode activated');
  }
}
```

---

## What Happens When FrameTape Is Not Loaded

All integration code is wrapped in `if (window.__AI_DEBUG__)` checks. If `frametape.js` is not included (e.g., in production), none of the debug code executes. The app runs normally with zero overhead.

This means you can safely leave the integration code in your production build — it's a no-op without the library.

---

## Checklist

- [ ] `frametape.js` loaded **before** application script
- [ ] State provider registered with getter and setter
- [ ] State object is JSON-serializable
- [ ] Canvas registered (if applicable)
- [ ] URL parameter auto-activation added
- [ ] Main loop uses `requestAnimationFrame` (not setInterval)
- [ ] All integration code guarded by `if (window.__AI_DEBUG__)`
- [ ] State is centralized in a single object

---

## Known Limitations (v1.0.0)

1. **Only wraps `requestAnimationFrame`** — `setInterval`/`setTimeout` based loops are not paused/stepped.
2. **Film strip requires a canvas** — DOM-based UIs don't get visual thumbnails (but state recording still works).
3. **State must be serializable** — Functions, DOM nodes, and circular references in state will cause errors.
4. **Single canvas support** — Only one canvas can be registered for film strip capture.
5. **Event wrapping is global** — All `addEventListener` calls for tracked event types are wrapped, even for elements unrelated to your app.
6. **No network request recording** — HTTP requests are not tracked (use browser dev tools for that).

---

## Future Improvements (Planned)

- Chrome screenshot integration for pixel-perfect visual capture
- Multiple canvas support
- DOM mutation observer for non-canvas UIs
- Network request recording
- Automated test scenario generation
- State diffing (show only what changed between frames)
