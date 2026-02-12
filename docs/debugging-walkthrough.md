# Debugging Walkthrough: Finding a Bug in the Snake Game

> This document walks through a real debugging session where FrameTape was used to find and fix a bug in the Snake game. It demonstrates the methodology an AI agent should follow.

See [FRAMETAPE.md](../FRAMETAPE.md) for overview | [API Reference](api-reference.md) for method details.

---

## The Setup

We have a Snake game (`index.html`) instrumented with FrameTape (`frametape.js`). The game:
- Runs on a 20×20 grid with a canvas
- Snake starts at center (10, 10), moving right, with 3 segments
- Food is placed randomly on initialization
- Arrow keys control direction, R restarts
- Score increments when food is eaten

## Phase 1: Smoke Test — Does the App Run?

**Goal:** Verify the application loads without errors.

```
Step 1: Navigate to http://localhost:9090/index.html?debug=ai
Step 2: Check console for errors
Step 3: Read initial state via JS injection:
```

```javascript
// Injected script:
JSON.stringify(window.__AI_DEBUG__.getSummary());
```

**What we observed:**
```json
{
  "mode": "ai",
  "paused": false,
  "frameCount": 45,
  "errorCount": 0,
  "state": {
    "snake": [{"x":10,"y":10}, {"x":9,"y":10}, {"x":8,"y":10}],
    "direction": "right",
    "food": {"x":14,"y":7},
    "score": 0,
    "started": false,
    "gameOver": false
  }
}
```

**Analysis:** App loaded successfully. Zero errors. Snake is at starting position. Food is placed. Game is waiting for first input. Debug mode is active. ✅

## Phase 2: Testing Basic Movement

**Goal:** Verify the snake moves correctly in all four directions.

### Testing Right Movement

```javascript
// 1. Pause the game
window.__AI_DEBUG__.pause();

// 2. Read initial state — note the head position
window.__AI_DEBUG__.getState();
// → snake[0] = {x:10, y:10}

// 3. Simulate pressing ArrowRight to start the game
document.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'}));

// 4. Step enough frames for one move (at 60fps with tickRate=8, ~8 frames per move)
window.__AI_DEBUG__.step(8);

// 5. Read state again
window.__AI_DEBUG__.getState();
// → snake[0] = {x:11, y:10}  ← moved 1 cell right ✅
```

### Testing Direction Changes

We repeated this for all four directions:
- **Right→Down:** Head y increases by 1 ✅
- **Down→Left:** Head x decreases by 1 ✅
- **Left→Up:** Head y decreases by 1 ✅

### Testing Reverse Prevention

```javascript
// Snake is moving right. Try to go left (opposite):
document.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft'}));
window.__AI_DEBUG__.step(8);
// → Snake still moves right. Reverse prevented. ✅
```

## Phase 3: Testing Food Consumption — THE BUG

**Goal:** Verify that eating food increments the score and the snake grows.

### The Test

```javascript
// 1. Pause and read state
window.__AI_DEBUG__.pause();
const state = window.__AI_DEBUG__.getState();
// → food is at {x:14, y:7}

// 2. Place the snake head right next to the food
window.__AI_DEBUG__.setState({
  snake: [{x:13, y:7}, {x:12, y:7}, {x:11, y:7}],
  direction: 'right',
  nextDirection: 'right',
  started: true
});

// 3. Step one move — the snake should eat the food
window.__AI_DEBUG__.step(8);

// 4. Check the result
const afterState = window.__AI_DEBUG__.getState();
```

### The Bug Discovery

During our initial testing of food consumption, we noticed something unexpected. When we examined the FrameTape recordings across the game start sequence, the food position **changed** between when the game was initialized and when the first arrow key was pressed.

**What the FrameTape showed:**

| Frame | Event | Food Position |
|---|---|---|
| 1 | Page load, `placeFood()` called | `{x:14, y:7}` |
| 45 | ArrowRight keydown | `{x:3, y:12}` ← **CHANGED!** |
| 53 | First snake move | `{x:3, y:12}` |

The food moved from `(14,7)` to `(3,12)` without being eaten. Something was re-placing the food on game start.

### Root Cause Analysis

We examined the `keydown` event handler in `index.html`:

```javascript
// THE BUGGY CODE:
if (!state.started) {
  state.started = true;
  state.food = placeFood(state);  // ← BUG: Re-places food unnecessarily!
  state.nextDirection = newDir;
  if (OPPOSITE[newDir] === state.direction) {
    state.nextDirection = state.direction;
  }
  return;
}
```

The line `state.food = placeFood(state)` was called every time the game transitioned from "not started" to "started" (i.e., on the first arrow key press). But food was **already placed** during initialization:

```javascript
// In the initialization section:
state.food = placeFood(state);  // Food placed here
render(state);                   // And rendered
requestAnimationFrame(gameLoop); // Game loop starts
```

So the food was placed twice:
1. On page load (correct)
2. On first keypress (redundant, overwrites the visible food with a new random position)

### Why This Is a Real Bug

From the user's perspective: they see food appear on the screen at one position, press an arrow key, and the food **jumps** to a completely different position. This is visually jarring and confusing. It's a subtle bug because:
- The game still "works" — food is always present
- The jump happens at the exact moment the game starts, so the user might not notice if they're focused on the snake
- Standard testing (just playing the game) might miss it entirely

### The Fix

Remove the redundant `placeFood()` call from the keydown handler:

```javascript
// FIXED CODE:
if (!state.started) {
  state.started = true;
  // Food is already placed during initialization, no need to re-place
  state.nextDirection = newDir;
  if (OPPOSITE[newDir] === state.direction) {
    state.nextDirection = state.direction;
  }
  return;
}
```

### Verification

After the fix, we re-tested with FrameTape:

```javascript
// 1. Read food position on load
const beforeStart = window.__AI_DEBUG__.getState();
// → food: {x:14, y:7}

// 2. Press arrow key to start
document.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'}));

// 3. Read food position after start
const afterStart = window.__AI_DEBUG__.getState();
// → food: {x:14, y:7}  ← SAME position! Bug fixed. ✅
```

## Phase 4: Testing Collisions

### Wall Collision

```javascript
// Place snake near the right wall, moving right
window.__AI_DEBUG__.setState({
  snake: [{x:19, y:10}, {x:18, y:10}, {x:17, y:10}],
  direction: 'right',
  nextDirection: 'right',
  started: true,
  gameOver: false
});

// Step one move — should hit the wall
window.__AI_DEBUG__.step(8);
const state = window.__AI_DEBUG__.getState();
// → gameOver: true ✅
```

### Self Collision

```javascript
// Create a snake that will collide with itself
window.__AI_DEBUG__.setState({
  snake: [
    {x:10, y:9},   // head — moving down
    {x:10, y:10},
    {x:11, y:10},
    {x:11, y:9},
    {x:10, y:9}    // tail at same position as head's target
  ],
  direction: 'down',
  nextDirection: 'down',
  started: true,
  gameOver: false
});

window.__AI_DEBUG__.step(8);
const state = window.__AI_DEBUG__.getState();
// → gameOver: true ✅
```

## Phase 5: Visual Verification

After all programmatic tests passed, we took screenshots in both modes:

1. **User mode** (`index.html` without `?debug=ai`) — clean game UI, no debug overlay
2. **AI debug mode** (`index.html?debug=ai`) — game + debug panel showing state, events, film strip

The film strip in the debug panel showed frame-by-frame thumbnails of the canvas, confirming visual state matched programmatic state.

---

## Key Takeaways for AI Agents

1. **Always start with `getSummary()`** — it gives you everything at once: mode, state, errors, frame count.

2. **Use `pause()` + `step()` for precise testing** — don't try to test in real-time. You can't react fast enough, and timing is unpredictable.

3. **Use `setState()` to set up test scenarios** — don't try to play the game to reach a specific state. Inject it directly.

4. **Compare state before and after stepping** — this is how you verify behavior. Read state → step → read state → compare.

5. **Check `getErrors()` frequently** — JS errors might not crash the app but indicate bugs.

6. **The FrameTape is your history** — use `getLastFrames()` to see what happened over the last N frames, including all state transitions and events.

7. **Food placement bug pattern** — watch for initialization code that runs twice. FrameTape makes this visible by showing state changes across frames that shouldn't have changes.

8. **Frame math matters** — the Snake game moves every ~8 frames (60fps ÷ 8 tickRate). When stepping, you need to step enough frames to trigger a move. Use `step(8)` or check `moveCounter` in state.
