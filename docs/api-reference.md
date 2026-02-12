# FrameTape API Reference

> Complete reference for `window.__AI_DEBUG__`. See [FRAMETAPE.md](../FRAMETAPE.md) for overview and quickstart.

## Mode Control

### `setMode(mode)` → `{ mode }`
Switches between `'user'` (normal) and `'ai'` (debug) mode.
- In `'ai'` mode: creates the debug panel overlay, enables all debug features.
- In `'user'` mode: removes debug panel, resets pause/step/slowMotion to defaults.

```javascript
__AI_DEBUG__.setMode('ai');   // → { mode: 'ai' }
__AI_DEBUG__.setMode('user'); // → { mode: 'user' }
```

### `getMode()` → `string`
Returns current mode: `'user'` or `'ai'`.

---

## Frame Control

These methods control `requestAnimationFrame` execution. They only have effect in `'ai'` mode.

### `pause()` → `{ paused: true, frame: number }`
Stops all frame execution immediately. The application freezes. No callbacks fire until you `step()` or `resume()`.

```javascript
__AI_DEBUG__.pause();
// → { paused: true, frame: 142 }
```

### `resume()` → `{ paused: false, frame: number }`
Resumes normal frame execution. If slow motion was set, it continues at slow-motion speed.

```javascript
__AI_DEBUG__.resume();
// → { paused: false, frame: 142 }
```

### `step(n?)` → `Promise<{ frame, state, timeout? }>`
Advances exactly `n` frames (default: 1), then pauses again. Returns a Promise that resolves with the state after the last stepped frame.

```javascript
const result = await __AI_DEBUG__.step(1);
// → { frame: 143, state: { snake: [...], score: 3, ... } }
```

**Note:** The promise has a 5-second safety timeout. If the frame doesn't execute within 5s, it resolves with `{ timeout: true }`.

**Important for script injection:** If you're calling this from `chrome_inject_script` or similar tools that don't support `await`, use `stepSync()` instead.

### `stepSync(n?)` → `{ stepping: true, stepsRemaining: number, frame: number }`
Non-blocking version of `step()`. Initiates stepping but returns immediately. The frame will execute asynchronously. Call `getState()` after a short delay to read the result.

```javascript
__AI_DEBUG__.stepSync(1);
// → { stepping: true, stepsRemaining: 1, frame: 142 }
// ... frame executes asynchronously ...
// After ~50ms, call getState() to see the updated state
```

### `setSlowMotion(fps)` → `{ slowMotionFPS: number }`
Sets the frame rate to `fps` frames per second. Useful for observing animations at human-readable speed. Unpauses if paused.

```javascript
__AI_DEBUG__.setSlowMotion(2);  // 2 frames per second
__AI_DEBUG__.setSlowMotion(1);  // 1 frame per second (very slow)
```

### `clearSlowMotion()` → `{ slowMotionFPS: null }`
Returns to normal frame rate (as fast as the browser allows, typically 60 FPS).

---

## State Management

### `getState()` → `object | null`
Returns a deep copy of the application's current state. Returns `null` if no state provider is registered.

```javascript
__AI_DEBUG__.getState();
// → { snake: [{x:10,y:10}, ...], direction: 'right', score: 3, food: {x:5,y:8}, ... }
```

**The returned object is a deep copy** — modifying it does not affect the app. Use `setState()` to modify.

### `setState(patch)` → `{ success: boolean, state?: object, error?: string }`
Merges a patch object into the application state. Only modifies the keys you provide. The state injector function (registered by the app) determines how the merge works.

```javascript
__AI_DEBUG__.setState({ score: 10 });
// → { success: true, state: { ..., score: 10, ... } }

__AI_DEBUG__.setState({ food: { x: 0, y: 0 } });
// → { success: true, state: { ..., food: { x: 0, y: 0 }, ... } }

// Set up a specific snake position for testing:
__AI_DEBUG__.setState({
  snake: [{ x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17, y: 10 }],
  direction: 'right',
  nextDirection: 'right'
});
```

---

## Registration (called by the application, not by AI)

### `registerStateProvider(getter, setter?)`
Registers functions that FrameTape uses to read and write application state.
- `getter()` — must return the current state object
- `setter(patch)` — receives a patch object to merge into state

### `registerCanvas(canvas)`
Registers the canvas element for film strip capture. Without this, film strip is empty.

---

## FrameTape (Frame History)

### `getFrameTape(from?, to?)` → `Array<FrameRecord>`
Returns a slice of the recorded frame tape. Default: all frames.

```javascript
__AI_DEBUG__.getFrameTape(100, 110); // frames 100-109
```

### `getLastFrames(n?)` → `Array<FrameRecord>`
Returns the last `n` recorded frames (default: 10).

```javascript
__AI_DEBUG__.getLastFrames(5);
// → [ { frame: 138, timestamp: ..., state: {...}, events: [...], ... }, ... ]
```

**FrameRecord structure:**
```javascript
{
  frame: 142,                    // frame number
  timestamp: 12345.67,           // performance.now() value
  duration: 16.7,                // ms since previous frame
  state: { ... },                // deep copy of app state
  events: [                      // events during this frame
    { type: 'keydown', key: 'ArrowRight', code: 'ArrowRight', frame: 142, timestamp: 12340.5 }
  ],
  errors: [],                    // JS errors during this frame
  performance: {
    memory: { usedJSHeapSize: ..., totalJSHeapSize: ... } // or null
  }
}
```

### `getFrameCount()` → `number`
Returns the total number of frames executed since page load (or last reset).

---

## Film Strip

### `getFilmStrip()` → `Array<{ frame: number }>`
Returns metadata about captured film strip thumbnails. The actual image data is rendered in the debug panel overlay.

**Note:** Film strip images are stored internally as data URLs on canvas thumbnails. The current API returns only frame numbers. Visual inspection is done through the debug panel or screenshots.

---

## Events

### `getEventLog(n?)` → `Array<EventRecord>`
Returns the last `n` events (default: 20). Events are automatically captured from `keydown`, `keyup`, `click`, `mousedown`, `mouseup`, `touchstart`, `touchend`.

```javascript
__AI_DEBUG__.getEventLog(5);
// → [
//   { type: 'keydown', key: 'ArrowRight', code: 'ArrowRight', frame: 100, timestamp: 5432.1 },
//   { type: 'keyup', key: 'ArrowRight', code: 'ArrowRight', frame: 102, timestamp: 5500.3 },
//   ...
// ]
```

---

## Error Tracking

### `getErrors()` → `Array<ErrorRecord>`
Returns all captured JavaScript errors and unhandled promise rejections.

```javascript
__AI_DEBUG__.getErrors();
// → [ { message: 'Cannot read property...', filename: '...', lineno: 42, frame: 55, timestamp: ... } ]
```

### `clearErrors()` → `{ cleared: true }`
Clears the error log.

---

## Deterministic Random

### `setRandomSeed(seed)` → `{ seed: number }`
Replaces `Math.random` with a seeded PRNG (Mulberry32). All subsequent `Math.random()` calls return deterministic values based on the seed. Useful for reproducible test scenarios.

```javascript
__AI_DEBUG__.setRandomSeed(42);
Math.random(); // always returns the same sequence for seed 42
```

### `clearRandomSeed()` → `{ cleared: true }`
Restores the original `Math.random`.

---

## Utility

### `getSummary()` → `object`
Returns a comprehensive status snapshot. **This is the best single call for understanding current state.**

```javascript
__AI_DEBUG__.getSummary();
// → {
//   mode: 'ai',
//   paused: true,
//   stepping: false,
//   slowMotionFPS: null,
//   frameCount: 142,
//   tapeLength: 142,
//   filmStripLength: 12,
//   eventCount: 8,
//   errorCount: 0,
//   avgFrameDuration: 16.5,
//   estimatedFPS: 61,
//   state: { snake: [...], score: 3, ... },
//   recentErrors: []
// }
```

### `getConfig()` → `object`
Returns current configuration.

### `setConfig(overrides)` → `object`
Merges overrides into configuration. Available config keys:

| Key | Default | Description |
|---|---|---|
| `maxTapeLength` | 500 | Maximum frames kept in tape |
| `filmStripFrames` | 12 | Number of film strip thumbnails |
| `filmStripWidth` | 120 | Thumbnail width (px) |
| `filmStripHeight` | 120 | Thumbnail height (px) |
| `filmStripCaptureEvery` | 1 | Capture every N frames |
| `debugPanelWidth` | 320 | Debug panel width (px) |
| `defaultSlowMotionFPS` | 2 | Default slow-motion FPS |

### `reset()` → `{ reset: true }`
Resets all counters, clears tape, film strip, event log, and errors. Does not change mode or unregister providers.

---

## Properties

| Property | Value |
|---|---|
| `version` | `'1.0.0'` |
| `name` | `'FrameTape'` |
