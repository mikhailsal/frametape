/**
 * FrameTape — AI Debug Instrumentation Library
 * https://github.com/mikhailsal/frametape
 * 
 * Provides window.__AI_DEBUG__ API for AI-driven debugging of web applications.
 * Features:
 *   - Frame Controller: pause, step, slow-motion control over requestAnimationFrame
 *   - FrameTape: per-frame state recording with timestamps and performance metrics
 *   - Film Strip: visual capture of canvas frames for temporal context
 *   - Debug Panel: overlay showing state, events, film strip, and metrics
 *   - Event Recording: logs keyboard, mouse, and custom events
 */
(function () {
  'use strict';

  // ============================================================
  // Configuration
  // ============================================================
  const CONFIG = {
    maxTapeLength: 500,       // max frames to keep in tape
    filmStripFrames: 12,      // number of thumbnails in film strip
    filmStripWidth: 120,      // thumbnail width in px
    filmStripHeight: 120,     // thumbnail height in px
    filmStripCaptureEvery: 1, // capture every N frames
    debugPanelWidth: 320,     // debug panel width in px
    defaultSlowMotionFPS: 2,  // default slow-mo FPS
  };

  // ============================================================
  // State
  // ============================================================
  let mode = 'user';               // 'user' | 'ai'
  let paused = false;
  let stepping = false;
  let stepsRemaining = 0;
  let slowMotionFPS = null;        // null = normal speed
  let frameCount = 0;
  let lastFrameTime = 0;
  let frameTape = [];
  let filmStripBuffer = [];        // circular buffer of canvas data URLs
  let eventLog = [];               // recent events
  let pendingEvents = [];          // events since last frame
  let stateProvider = null;        // function that returns app state
  let stateInjector = null;        // function that sets app state
  let sourceCanvas = null;         // the canvas to capture for film strip
  let debugPanelEl = null;
  let randomSeed = null;
  let originalRAF = null;
  let originalSetTimeout = null;
  let originalSetInterval = null;
  let rafCallbacks = [];           // queued rAF callbacks
  let rafIdCounter = 0;
  let isRunningFrame = false;
  let frameResolve = null;         // resolve function for step() promise
  let lastSlowMotionTime = 0;
  let jsErrors = [];

  // ============================================================
  // Seeded Random (Mulberry32)
  // ============================================================
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  let seededRandom = null;
  const originalMathRandom = Math.random;

  function setRandomSeed(seed) {
    randomSeed = seed;
    seededRandom = mulberry32(seed);
    Math.random = seededRandom;
  }

  function clearRandomSeed() {
    randomSeed = null;
    seededRandom = null;
    Math.random = originalMathRandom;
  }

  // ============================================================
  // Error Capturing
  // ============================================================
  window.addEventListener('error', function (e) {
    const err = {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      timestamp: performance.now(),
      frame: frameCount,
    };
    jsErrors.push(err);
    pendingEvents.push({ type: 'error', data: err, timestamp: performance.now() });
  });

  window.addEventListener('unhandledrejection', function (e) {
    const err = {
      message: e.reason ? (e.reason.message || String(e.reason)) : 'Unknown',
      timestamp: performance.now(),
      frame: frameCount,
    };
    jsErrors.push(err);
    pendingEvents.push({ type: 'unhandledrejection', data: err, timestamp: performance.now() });
  });

  // ============================================================
  // Event Instrumentation
  // ============================================================
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const trackedEventTypes = ['keydown', 'keyup', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchend'];

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (trackedEventTypes.includes(type)) {
      const wrappedListener = function (event) {
        const eventData = {
          type: event.type,
          timestamp: performance.now(),
          frame: frameCount,
        };
        if (event instanceof KeyboardEvent) {
          eventData.key = event.key;
          eventData.code = event.code;
        }
        if (event instanceof MouseEvent) {
          eventData.x = event.clientX;
          eventData.y = event.clientY;
          eventData.button = event.button;
        }
        pendingEvents.push(eventData);
        return listener.call(this, event);
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // ============================================================
  // requestAnimationFrame Wrapper (Frame Controller)
  // ============================================================
  originalRAF = window.requestAnimationFrame;

  function wrappedRAF(callback) {
    const id = ++rafIdCounter;
    rafCallbacks.push({ id, callback });

    if (mode === 'user' || (!paused && !stepping && slowMotionFPS === null)) {
      // Normal mode — pass through immediately
      return originalRAF.call(window, function (timestamp) {
        executeFrame(timestamp);
      });
    }

    if (paused && !stepping) {
      // Paused — don't schedule, wait for step()
      return id;
    }

    if (stepping && stepsRemaining > 0) {
      // Stepping — schedule immediately
      return originalRAF.call(window, function (timestamp) {
        executeFrame(timestamp);
      });
    }

    if (slowMotionFPS !== null && !paused) {
      // Slow motion — schedule with delay
      const delay = 1000 / slowMotionFPS;
      const now = performance.now();
      const timeSinceLast = now - lastSlowMotionTime;
      const waitTime = Math.max(0, delay - timeSinceLast);

      setTimeout(function () {
        originalRAF.call(window, function (timestamp) {
          lastSlowMotionTime = performance.now();
          executeFrame(timestamp);
        });
      }, waitTime);
      return id;
    }

    // Default: schedule normally
    return originalRAF.call(window, function (timestamp) {
      executeFrame(timestamp);
    });
  }

  function executeFrame(timestamp) {
    if (rafCallbacks.length === 0) return;

    isRunningFrame = true;
    const frameDuration = timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    frameCount++;

    // Execute all queued callbacks
    const callbacks = rafCallbacks.slice();
    rafCallbacks = [];

    for (const { callback } of callbacks) {
      try {
        callback(timestamp);
      } catch (e) {
        jsErrors.push({
          message: e.message,
          stack: e.stack,
          frame: frameCount,
          timestamp: performance.now(),
        });
      }
    }

    // Record frame to tape
    recordFrame(timestamp, frameDuration);

    // Capture film strip
    if (sourceCanvas && frameCount % CONFIG.filmStripCaptureEvery === 0) {
      captureFilmStrip();
    }

    // Update debug panel
    if (mode === 'ai' && debugPanelEl) {
      updateDebugPanel();
    }

    isRunningFrame = false;

    // Handle stepping
    if (stepping) {
      stepsRemaining--;
      if (stepsRemaining <= 0) {
        stepping = false;
        paused = true;
        if (frameResolve) {
          frameResolve({ frame: frameCount, state: getState() });
          frameResolve = null;
        }
      }
    }
  }

  window.requestAnimationFrame = wrappedRAF;

  // ============================================================
  // FrameTape Recording
  // ============================================================
  function recordFrame(timestamp, duration) {
    const frameData = {
      frame: frameCount,
      timestamp: timestamp,
      duration: duration,
      state: getState(),
      events: pendingEvents.slice(),
      errors: jsErrors.filter(e => e.frame === frameCount),
      performance: {
        memory: performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
        } : null,
      },
    };

    frameTape.push(frameData);
    eventLog.push(...pendingEvents);
    pendingEvents = [];

    // Trim tape
    if (frameTape.length > CONFIG.maxTapeLength) {
      frameTape = frameTape.slice(-CONFIG.maxTapeLength);
    }
    // Trim event log
    if (eventLog.length > 200) {
      eventLog = eventLog.slice(-200);
    }
  }

  // ============================================================
  // State Management
  // ============================================================
  function getState() {
    if (stateProvider) {
      try {
        return JSON.parse(JSON.stringify(stateProvider()));
      } catch (e) {
        return { error: 'Failed to serialize state: ' + e.message };
      }
    }
    return null;
  }

  // ============================================================
  // Film Strip Capture
  // ============================================================
  function captureFilmStrip() {
    if (!sourceCanvas) return;

    try {
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = CONFIG.filmStripWidth;
      thumbCanvas.height = CONFIG.filmStripHeight;
      const ctx = thumbCanvas.getContext('2d');
      ctx.drawImage(sourceCanvas, 0, 0, CONFIG.filmStripWidth, CONFIG.filmStripHeight);

      filmStripBuffer.push({
        frame: frameCount,
        dataUrl: thumbCanvas.toDataURL('image/png', 0.8),
      });

      if (filmStripBuffer.length > CONFIG.filmStripFrames) {
        filmStripBuffer = filmStripBuffer.slice(-CONFIG.filmStripFrames);
      }
    } catch (e) {
      // Canvas might be tainted, ignore
    }
  }

  // ============================================================
  // Debug Panel
  // ============================================================
  function createDebugPanel() {
    if (debugPanelEl) return;

    debugPanelEl = document.createElement('div');
    debugPanelEl.id = 'frametape-panel';
    debugPanelEl.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: ${CONFIG.debugPanelWidth}px;
      height: 100vh;
      background: #1a1a2e;
      color: #e0e0e0;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      overflow-y: auto;
      overflow-x: hidden;
      z-index: 999999;
      border-left: 2px solid #00ff88;
      box-sizing: border-box;
      padding: 8px;
    `;

    debugPanelEl.innerHTML = `
      <div style="background:#00ff88;color:#1a1a2e;padding:4px 8px;margin:-8px -8px 8px -8px;font-weight:bold;font-size:13px;text-align:center;">
        🤖 AI DEBUG MODE
      </div>
      <div id="frametape-frame" style="margin-bottom:8px;color:#00ff88;">Frame: 0</div>
      <div id="frametape-perf" style="margin-bottom:8px;color:#ffaa00;">FPS: --</div>
      <div style="color:#00aaff;font-weight:bold;margin-bottom:4px;">STATE:</div>
      <pre id="frametape-state" style="background:#0d0d1a;padding:6px;border-radius:4px;max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;font-size:10px;margin-bottom:8px;border:1px solid #333;"></pre>
      <div style="color:#00aaff;font-weight:bold;margin-bottom:4px;">EVENTS:</div>
      <div id="frametape-events" style="background:#0d0d1a;padding:6px;border-radius:4px;max-height:120px;overflow-y:auto;font-size:10px;margin-bottom:8px;border:1px solid #333;"></div>
      <div style="color:#00aaff;font-weight:bold;margin-bottom:4px;">ERRORS:</div>
      <div id="frametape-errors" style="background:#0d0d1a;padding:6px;border-radius:4px;max-height:80px;overflow-y:auto;font-size:10px;margin-bottom:8px;border:1px solid #333;color:#ff4444;">None</div>
      <div style="color:#00aaff;font-weight:bold;margin-bottom:4px;">FILM STRIP:</div>
      <div id="frametape-filmstrip" style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;"></div>
    `;

    document.body.appendChild(debugPanelEl);
  }

  function removeDebugPanel() {
    if (debugPanelEl) {
      debugPanelEl.remove();
      debugPanelEl = null;
    }
  }

  function updateDebugPanel() {
    if (!debugPanelEl) return;

    // Frame counter
    const frameEl = document.getElementById('frametape-frame');
    if (frameEl) {
      frameEl.textContent = `Frame: ${frameCount} | ${paused ? 'PAUSED' : stepping ? 'STEPPING' : slowMotionFPS ? `SLOW(${slowMotionFPS}fps)` : 'RUNNING'}`;
    }

    // Performance
    const perfEl = document.getElementById('frametape-perf');
    if (perfEl && frameTape.length > 1) {
      const recent = frameTape.slice(-30);
      const avgDuration = recent.reduce((sum, f) => sum + (f.duration || 0), 0) / recent.length;
      const fps = avgDuration > 0 ? (1000 / avgDuration).toFixed(1) : '--';
      perfEl.textContent = `FPS: ${fps} | Avg frame: ${avgDuration.toFixed(1)}ms`;
    }

    // State
    const stateEl = document.getElementById('frametape-state');
    if (stateEl) {
      const state = getState();
      stateEl.textContent = state ? JSON.stringify(state, null, 2) : 'No state provider';
    }

    // Events
    const eventsEl = document.getElementById('frametape-events');
    if (eventsEl) {
      const recentEvents = eventLog.slice(-10);
      if (recentEvents.length === 0) {
        eventsEl.textContent = 'No events yet';
      } else {
        eventsEl.innerHTML = recentEvents.map(e => {
          const parts = [`<span style="color:#888;">F${e.frame || '?'}</span>`];
          parts.push(`<span style="color:#ffaa00;">${e.type}</span>`);
          if (e.key) parts.push(`key=${e.key}`);
          if (e.x !== undefined) parts.push(`(${e.x},${e.y})`);
          return parts.join(' ');
        }).join('<br>');
      }
    }

    // Errors
    const errorsEl = document.getElementById('frametape-errors');
    if (errorsEl) {
      if (jsErrors.length === 0) {
        errorsEl.textContent = 'None';
        errorsEl.style.color = '#00ff88';
      } else {
        errorsEl.style.color = '#ff4444';
        errorsEl.innerHTML = jsErrors.slice(-5).map(e =>
          `<div>F${e.frame}: ${e.message}</div>`
        ).join('');
      }
    }

    // Film strip
    const filmEl = document.getElementById('frametape-filmstrip');
    if (filmEl) {
      filmEl.innerHTML = filmStripBuffer.map(f =>
        `<div style="text-align:center;">
          <img src="${f.dataUrl}" style="width:${CONFIG.filmStripWidth / 2}px;height:${CONFIG.filmStripHeight / 2}px;border:1px solid #444;border-radius:2px;" />
          <div style="font-size:9px;color:#888;">F${f.frame}</div>
        </div>`
      ).join('');
    }
  }

  // ============================================================
  // Public API: window.__AI_DEBUG__
  // ============================================================
  window.__AI_DEBUG__ = {
    // --- Mode ---
    setMode: function (newMode) {
      mode = newMode;
      if (mode === 'ai') {
        createDebugPanel();
      } else {
        removeDebugPanel();
        paused = false;
        stepping = false;
        slowMotionFPS = null;
      }
      return { mode };
    },

    getMode: function () {
      return mode;
    },

    // --- Frame Control ---
    pause: function () {
      paused = true;
      stepping = false;
      return { paused: true, frame: frameCount };
    },

    resume: function () {
      paused = false;
      stepping = false;
      // Re-trigger the rAF loop if there are pending callbacks
      if (rafCallbacks.length > 0) {
        originalRAF.call(window, function (ts) { executeFrame(ts); });
      }
      // Also notify the app to request a new frame
      return { paused: false, frame: frameCount };
    },

    step: function (n) {
      n = n || 1;
      stepsRemaining = n;
      stepping = true;
      paused = false;

      // Trigger the next frame
      if (rafCallbacks.length > 0) {
        originalRAF.call(window, function (ts) { executeFrame(ts); });
      }

      return new Promise(function (resolve) {
        frameResolve = resolve;
        // Timeout safety
        setTimeout(function () {
          if (frameResolve === resolve) {
            frameResolve = null;
            resolve({ frame: frameCount, state: getState(), timeout: true });
          }
        }, 5000);
      });
    },

    // Synchronous step — advances frame and returns state immediately after
    // This is useful when calling from evaluate() which may not handle promises
    stepSync: function (n) {
      n = n || 1;
      stepsRemaining = n;
      stepping = true;
      paused = false;

      // Trigger frames
      if (rafCallbacks.length > 0) {
        originalRAF.call(window, function (ts) { executeFrame(ts); });
      }

      return { stepping: true, stepsRemaining: n, frame: frameCount };
    },

    setSlowMotion: function (fps) {
      slowMotionFPS = fps;
      paused = false;
      stepping = false;
      lastSlowMotionTime = performance.now();
      // Re-trigger loop
      if (rafCallbacks.length > 0) {
        originalRAF.call(window, function (ts) { executeFrame(ts); });
      }
      return { slowMotionFPS: fps };
    },

    clearSlowMotion: function () {
      slowMotionFPS = null;
      return { slowMotionFPS: null };
    },

    // --- State ---
    getState: function () {
      return getState();
    },

    setState: function (patch) {
      if (stateInjector) {
        stateInjector(patch);
        return { success: true, state: getState() };
      }
      return { success: false, error: 'No state injector registered' };
    },

    // --- Registration ---
    registerStateProvider: function (getter, setter) {
      stateProvider = getter;
      stateInjector = setter || null;
    },

    registerCanvas: function (canvas) {
      sourceCanvas = canvas;
    },

    // --- FrameTape ---
    getFrameTape: function (from, to) {
      from = from || 0;
      to = to || frameTape.length;
      return frameTape.slice(from, to);
    },

    getLastFrames: function (n) {
      n = n || 10;
      return frameTape.slice(-n);
    },

    getFrameCount: function () {
      return frameCount;
    },

    // --- Film Strip ---
    getFilmStrip: function () {
      return filmStripBuffer.map(f => ({ frame: f.frame }));
    },

    // --- Events ---
    getEventLog: function (n) {
      n = n || 20;
      return eventLog.slice(-n);
    },

    // --- Errors ---
    getErrors: function () {
      return jsErrors.slice();
    },

    clearErrors: function () {
      jsErrors = [];
      return { cleared: true };
    },

    // --- Random Seed ---
    setRandomSeed: function (seed) {
      setRandomSeed(seed);
      return { seed };
    },

    clearRandomSeed: function () {
      clearRandomSeed();
      return { cleared: true };
    },

    // --- Utility ---
    getConfig: function () {
      return { ...CONFIG };
    },

    setConfig: function (overrides) {
      Object.assign(CONFIG, overrides);
      return { ...CONFIG };
    },

    getSummary: function () {
      const recentFrames = frameTape.slice(-60);
      const avgDuration = recentFrames.length > 0
        ? recentFrames.reduce((s, f) => s + (f.duration || 0), 0) / recentFrames.length
        : 0;
      return {
        mode,
        paused,
        stepping,
        slowMotionFPS,
        frameCount,
        tapeLength: frameTape.length,
        filmStripLength: filmStripBuffer.length,
        eventCount: eventLog.length,
        errorCount: jsErrors.length,
        avgFrameDuration: Math.round(avgDuration * 100) / 100,
        estimatedFPS: avgDuration > 0 ? Math.round(1000 / avgDuration) : null,
        state: getState(),
        recentErrors: jsErrors.slice(-3),
      };
    },

    // --- Reset ---
    reset: function () {
      frameCount = 0;
      frameTape = [];
      filmStripBuffer = [];
      eventLog = [];
      pendingEvents = [];
      jsErrors = [];
      paused = false;
      stepping = false;
      stepsRemaining = 0;
      return { reset: true };
    },

    // --- Version ---
    version: '1.0.0',
    name: 'FrameTape',
  };

  console.log('%c🤖 FrameTape AI Debug Library v1.0.0 loaded', 'color: #00ff88; font-weight: bold;');
  console.log('%c   Use window.__AI_DEBUG__.setMode("ai") to activate AI debug mode', 'color: #888;');

})();
