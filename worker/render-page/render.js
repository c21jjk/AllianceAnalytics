/*
 * render-page/render.js
 * ---------------------------------------------------------------------------
 * Browser-side frame renderer for the Alliance Reel pipeline. Loaded by
 * index.html inside a headless Chromium tab driven by Playwright (see
 * worker/src/render/render-scene.ts).
 *
 * Surface (the only thing render-scene.ts calls):
 *   window.renderSceneFrame(sceneJson, frameIndex, totalFrames)
 *     → Promise<string> resolving to a "data:image/png;base64,..." URL.
 *
 * Two scene kinds are supported in MVP:
 *   1. "design" — a static CanvasTemplateSchema (text + image + shape
 *      layers). Same output for every frame in the scene (no per-frame
 *      motion within design scenes for MVP).
 *   2. "photo"  — a single photo with a Ken-Burns motion path (startRect
 *      → endRect, eased). Per-frame the source crop is interpolated and
 *      drawn `object-fit: cover` into the 1080×1920 canvas.
 *
 * "video_clip" is RESERVED — the worker rejects it before reaching here.
 *
 * Strictness rules mirroring the TS code in src/:
 *   - Plain ES5-ish JS, no transpiler. Targeting Chromium 120+ from the
 *     Playwright base image is safe for modern syntax, but we keep
 *     things conservative.
 *   - All async work goes through Promises; never block the page loop.
 *   - Every image load uses `crossOrigin = "anonymous"` so the canvas
 *     never becomes tainted (a tainted canvas throws SecurityError on
 *     toDataURL).
 *   - All caches live at module scope so successive frames in the same
 *     scene share work (photo decode is the heavy cost).
 */

/* global fabric */

(function attachRenderer(globalScope) {
  "use strict";

  // -------------------------------------------------------------------------
  // Canonical dimensions
  // -------------------------------------------------------------------------
  // why: kept inline as literals so the page works even if the JS that
  // launched it forgot to inject a config object. The TS side validates
  // composition.width === 1080 && composition.height === 1920 long before
  // we get here, so this is intentionally not parameterized.
  var CANVAS_WIDTH = 1080;
  var CANVAS_HEIGHT = 1920;

  // -------------------------------------------------------------------------
  // Easing functions
  // -------------------------------------------------------------------------
  // why a tiny table not a switch: the four easing names align 1:1 with
  // the MotionPath.easing literal-union in worker/src/types.ts. Lookup is
  // O(1) and the function objects are cheaply hot-cached by V8.
  var EASING = {
    linear: function (t) {
      return t;
    },
    ease_in: function (t) {
      return t * t;
    },
    ease_out: function (t) {
      var inv = 1 - t;
      return 1 - inv * inv;
    },
    ease_in_out: function (t) {
      // 3t^2 - 2t^3 — smoothstep. Matches the canvas-editor's preview
      // animation curve exactly so the render is pixel-equivalent.
      return 3 * t * t - 2 * t * t * t;
    },
  };

  /**
   * Linearly interpolate between two scalars.
   * @param {number} a
   * @param {number} b
   * @param {number} t — already-eased parameter in [0..1].
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Lerp two MotionRects componentwise.
   * @param {{x:number,y:number,w:number,h:number}} a
   * @param {{x:number,y:number,w:number,h:number}} b
   * @param {number} t
   */
  function lerpRect(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      w: lerp(a.w, b.w, t),
      h: lerp(a.h, b.h, t),
    };
  }

  // -------------------------------------------------------------------------
  // Image cache — keyed by URL, value is a Promise<HTMLImageElement>
  // -------------------------------------------------------------------------
  // why a module-level cache: a 30fps × 1.5s photo scene calls into
  // renderPhotoScene 45 times for the same photo URL. Without a cache
  // we'd re-decode the photo every frame, costing tens of ms per frame
  // and 45 redundant network fetches. With this cache, the photo is
  // fetched + decoded once per scene and reused for every subsequent
  // frame in the same browser session.
  var imageCache = Object.create(null);

  // why a load timeout: a stalled photo fetch (slow CDN, dead URL that
  // never errors) would otherwise hang the page.evaluate forever and pin
  // the whole render job. 20s is generous for a single listing photo.
  var IMAGE_LOAD_TIMEOUT_MS = 20000;

  /**
   * Load an image with anonymous CORS, returning a Promise that resolves
   * to the HTMLImageElement once it's decoded. Rejects after
   * IMAGE_LOAD_TIMEOUT_MS so a hung fetch can't stall the job; callers
   * decide how to degrade (design layers skip with a warn, photo scenes
   * render a black frame).
   *
   * @param {string} url
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(url) {
    if (imageCache[url]) return imageCache[url];

    var p = new Promise(function (resolve, reject) {
      // why the timer lives inside the executor: it must start when the
      // load starts and be cleared on both resolve and reject paths.
      var settled = false;
      var timer = setTimeout(function () {
        // why evict from cache: a timed-out URL may load fine on the
        // next job; a cached rejection would poison every later render
        // in the same browser session. The wrapped reject below handles
        // the settled bookkeeping.
        delete imageCache[url];
        reject(new Error("Image load timed out after " + IMAGE_LOAD_TIMEOUT_MS + "ms: " + url));
      }, IMAGE_LOAD_TIMEOUT_MS);
      var settle = function (fn, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      resolve = (function (orig) {
        return function (value) { settle(orig, value); };
      })(resolve);
      reject = (function (orig) {
        return function (err) { settle(orig, err); };
      })(reject);
      var img = new Image();
      // why crossOrigin BEFORE src: setting after triggering the load is
      // a common footgun — Chromium has already issued the request as
      // non-CORS and the resulting image taints the canvas. The order
      // here is load-bearing.
      img.crossOrigin = "anonymous";
      img.onload = function () {
        // decode() ensures the bitmap is fully ready to paint; without
        // it the first drawImage can occasionally render at decoded size
        // 0 and produce a 1KB "blank" PNG.
        if (typeof img.decode === "function") {
          img.decode().then(function () {
            resolve(img);
          }).catch(function () {
            // decode() rejects on some animated GIFs but the image is
            // still usable — fall through.
            resolve(img);
          });
        } else {
          resolve(img);
        }
      };
      img.onerror = function () {
        reject(new Error("Image load failed: " + url));
      };
      img.src = url;
    });

    imageCache[url] = p;
    return p;
  }

  // -------------------------------------------------------------------------
  // Canvas singleton — re-used across every renderSceneFrame call
  // -------------------------------------------------------------------------
  // why one canvas, not one-per-frame: Fabric canvas construction is
  // ~100ms and pushes a DOM node per call. Reusing the canvas + clearing
  // it between frames is ~5x faster and avoids slow DOM growth.
  var fabricCanvas = null;

  function getFabricCanvas() {
    if (fabricCanvas) return fabricCanvas;

    // Create the DOM <canvas> element first; Fabric needs it attached to
    // the document so it can measure fonts.
    var root = document.getElementById("render-root");
    if (!root) {
      throw new Error("render-root container missing from DOM");
    }
    var el = document.createElement("canvas");
    el.id = "fabric-render-canvas";
    el.width = CANVAS_WIDTH;
    el.height = CANVAS_HEIGHT;
    root.appendChild(el);

    // why `enableRetinaScaling: false`: we want 1080×1920 actual pixels
    // out, NOT 1080×1920 CSS pixels at devicePixelRatio. Retina scaling
    // would 2x the output buffer for nothing.
    fabricCanvas = new fabric.Canvas(el, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      enableRetinaScaling: false,
      renderOnAddRemove: false,
      backgroundColor: "#000000",
    });
    return fabricCanvas;
  }

  /** Clear all objects + reset background for a fresh frame. */
  function resetCanvas(bgColor) {
    var canvas = getFabricCanvas();
    canvas.clear();
    canvas.backgroundColor = bgColor || "#000000";
    return canvas;
  }

  // -------------------------------------------------------------------------
  // Design scene rendering
  // -------------------------------------------------------------------------
  /**
   * Render a CanvasTemplateSchema-shaped object onto the Fabric canvas.
   *
   * The schema mirrors lib/post-builder/canvas-editor/types.ts. We accept
   * any object that quacks like a CanvasTemplateSchema — i.e., has a
   * `layers: Array` field and optional `backgroundColor` / `backgroundImage`.
   *
   * Layers are sorted by `z` ascending then added to the canvas. Each
   * layer kind is hydrated in its own branch:
   *   - "text"  → fabric.Textbox / IText
   *   - "image" → fabric.Image (object-fit: cover|contain|stretch math)
   *   - "shape" → fabric.Rect | Circle | Ellipse | Line
   *   - "group" → recurse (RESERVED, not yet exercised by templates)
   *
   * MVP scope: no per-layer animation. The output is identical for
   * every frame of the scene, so render-scene.ts can call this once and
   * reuse the PNG buffer for the whole scene if it wants to optimize.
   * We deliberately re-render anyway today — keeps the code path uniform
   * with photo scenes (motion math) and the savings are small relative
   * to the photo path.
   *
   * @param {object} schema
   * @returns {Promise<void>}
   */
  function renderDesignScene(schema) {
    if (!schema || !Array.isArray(schema.layers)) {
      // why a hard throw: callers should ALWAYS pass a CanvasTemplateSchema-
      // shaped object for design scenes. The TS side resolves templateRef
      // before invoking; if it didn't, the failure is upstream and we want
      // a loud error rather than a silently-empty frame.
      throw new Error(
        "renderDesignScene: expected CanvasTemplateSchema-shaped object, got " +
          typeof schema,
      );
    }

    var canvas = resetCanvas(schema.backgroundColor || "#000000");

    // Background image (optional). Drawn underneath all layers.
    var bgPromise = Promise.resolve();
    if (schema.backgroundImage) {
      bgPromise = loadImage(schema.backgroundImage).then(function (img) {
        // object-fit: cover for the background
        var rect = computeCoverRect(
          img.naturalWidth,
          img.naturalHeight,
          CANVAS_WIDTH,
          CANVAS_HEIGHT,
        );
        var fabricImg = new fabric.Image(img, {
          left: rect.left,
          top: rect.top,
          scaleX: rect.scaleX,
          scaleY: rect.scaleY,
          selectable: false,
          evented: false,
        });
        canvas.add(fabricImg);
      }).catch(function (err) {
        // why swallow: a broken or timed-out background image should
        // not blank the whole design scene; layers still render over
        // the solid backgroundColor.
        console.warn("Background image skipped: " + err.message);
      });
    }

    return bgPromise.then(function () {
      // Sort by z ascending so the highest-z renders on top.
      var layers = schema.layers.slice().sort(function (a, b) {
        return (a.z || 0) - (b.z || 0);
      });

      // Add layers sequentially; image layers are async (need decode).
      return layers.reduce(function (chain, layer) {
        return chain.then(function () {
          return addLayer(canvas, layer);
        });
      }, Promise.resolve());
    }).then(function () {
      canvas.renderAll();
    });
  }

  /**
   * Add one CanvasLayer to the Fabric canvas, awaiting any async (image)
   * setup before returning.
   *
   * @param {fabric.Canvas} canvas
   * @param {object} layer
   */
  function addLayer(canvas, layer) {
    if (!layer || layer.visible === false) return Promise.resolve();

    switch (layer.kind) {
      case "text":
        return addTextLayer(canvas, layer);
      case "image":
        return addImageLayer(canvas, layer);
      case "shape":
        return addShapeLayer(canvas, layer);
      case "group":
        // RESERVED — recurse over children. No templates use this yet.
        return (layer.children || []).reduce(function (chain, child) {
          return chain.then(function () {
            return addLayer(canvas, child);
          });
        }, Promise.resolve());
      default:
        // why warn-not-throw: an unknown layer kind is recoverable —
        // skip it and render the rest of the scene. A throw would
        // blank-frame the whole reel.
        console.warn("Unknown layer kind: " + layer.kind);
        return Promise.resolve();
    }
  }

  // Phase B.3 — Text effect → Fabric props. MUST mirror
  // lib/post-builder/canvas-editor/textEffects.ts exactly. If the two drift,
  // the server-rendered Reel won't match what Larissa saw in Studio.
  function textEffectToFabricProps(effect) {
    if (!effect || effect.kind === "none") {
      return { shadow: null, stroke: "", strokeWidth: 0, paintFirst: "fill" };
    }
    if (effect.kind === "shadow") {
      return {
        shadow: new fabric.Shadow({
          color: effect.color,
          offsetX: effect.offsetX,
          offsetY: effect.offsetY,
          blur: effect.blur,
        }),
        stroke: "",
        strokeWidth: 0,
        paintFirst: "fill",
      };
    }
    if (effect.kind === "outline") {
      return {
        shadow: null,
        stroke: effect.color,
        strokeWidth: effect.width,
        paintFirst: "stroke",
      };
    }
    if (effect.kind === "lift") {
      var clamped = Math.max(0, Math.min(1, effect.opacity));
      var alpha = Math.round(clamped * 255).toString(16);
      if (alpha.length < 2) alpha = "0" + alpha;
      return {
        shadow: new fabric.Shadow({
          color: "#000000" + alpha,
          offsetX: 0,
          offsetY: 4,
          blur: 12,
        }),
        stroke: "",
        strokeWidth: 0,
        paintFirst: "fill",
      };
    }
    if (effect.kind === "splice") {
      return {
        shadow: new fabric.Shadow({
          color: effect.outlineColor,
          offsetX: effect.offsetX,
          offsetY: effect.offsetY,
          blur: 0,
        }),
        stroke: effect.outlineColor,
        strokeWidth: effect.outlineWidth,
        paintFirst: "stroke",
      };
    }
    // Unknown effect kind — bail to "no effect" defaults rather than crashing.
    return { shadow: null, stroke: "", strokeWidth: 0, paintFirst: "fill" };
  }

  function addTextLayer(canvas, layer) {
    // why Textbox over IText: Textbox supports `width`-based wrapping
    // which mirrors the canvas-editor's `maxWidth` behaviour. IText
    // would honor newlines only.
    var text = layer.resolvedText != null ? layer.resolvedText : layer.text;
    // Phase B.3 — resolve text effect before constructing the textbox.
    var effectProps = textEffectToFabricProps(layer.effect);
    var t = new fabric.Textbox(text || "", {
      left: layer.left,
      top: layer.top,
      width: layer.width,
      angle: layer.angle || 0,
      opacity: layer.opacity != null ? layer.opacity : 1,
      fontFamily: layer.fontFamily || "Inter",
      fontSize: layer.fontSize || 32,
      fontWeight: layer.fontWeight || 400,
      fontStyle: layer.fontStyle || "normal",
      fill: layer.fill || "#FFFFFF",
      textAlign: layer.textAlign || "left",
      lineHeight: layer.lineHeight || 1.2,
      charSpacing: layer.charSpacing || 0,
      underline: !!layer.underline,
      linethrough: !!layer.linethrough,
      shadow: effectProps.shadow,
      stroke: effectProps.stroke,
      strokeWidth: effectProps.strokeWidth,
      paintFirst: effectProps.paintFirst,
      selectable: false,
      evented: false,
    });
    canvas.add(t);
    return Promise.resolve();
  }

  function addImageLayer(canvas, layer) {
    var src = layer.resolvedSrc != null ? layer.resolvedSrc : layer.src;
    if (!src) {
      // No source → render a placeholder rect so the layout still has
      // visual weight (matches canvas-editor MVP behaviour).
      var ph = new fabric.Rect({
        left: layer.left,
        top: layer.top,
        width: layer.width,
        height: layer.height,
        angle: layer.angle || 0,
        opacity: layer.opacity != null ? layer.opacity : 1,
        fill: "#1a1a1a",
        stroke: "#333",
        strokeWidth: 1,
        selectable: false,
        evented: false,
      });
      canvas.add(ph);
      return Promise.resolve();
    }

    return loadImage(src).then(function (img) {
      var natW = img.naturalWidth || img.width;
      var natH = img.naturalHeight || img.height;
      var fit = layer.objectFit || "cover";
      var sx;
      var sy;
      if (fit === "stretch") {
        sx = layer.width / natW;
        sy = layer.height / natH;
      } else if (fit === "contain") {
        var containScale = Math.min(layer.width / natW, layer.height / natH);
        sx = containScale;
        sy = containScale;
      } else {
        var coverScale = Math.max(layer.width / natW, layer.height / natH);
        sx = coverScale;
        sy = coverScale;
      }

      var fImg = new fabric.Image(img, {
        left: layer.left,
        top: layer.top,
        scaleX: sx,
        scaleY: sy,
        angle: layer.angle || 0,
        opacity: layer.opacity != null ? layer.opacity : 1,
        selectable: false,
        evented: false,
      });

      // Object-fit: cover/contain centers the image inside the layer
      // rect; the simple Fabric placement above puts the image's
      // top-left at layer.left/top. Offset to center.
      if (fit !== "stretch") {
        var renderedW = natW * sx;
        var renderedH = natH * sy;
        fImg.left = layer.left + (layer.width - renderedW) / 2;
        fImg.top = layer.top + (layer.height - renderedH) / 2;
      }

      // Optional corner-radius clipping. why clipPath not borderRadius:
      // Fabric.Image has no built-in radius prop; clipPath at the image
      // layer is the documented approach.
      if (layer.cornerRadius && layer.cornerRadius > 0) {
        var clip = new fabric.Rect({
          left: -(natW * sx) / 2,
          top: -(natH * sy) / 2,
          width: natW * sx,
          height: natH * sy,
          rx: layer.cornerRadius,
          ry: layer.cornerRadius,
        });
        fImg.clipPath = clip;
      }

      canvas.add(fImg);
    }).catch(function (err) {
      // why swallow: one broken image shouldn't blank the whole reel.
      // Log and continue — the rest of the scene still renders.
      console.warn("Image layer skipped: " + err.message);
    });
  }

  /**
   * Structural runtime check — does `fill` look like a GradientFill?
   *
   * why inline: this file is plain JS loaded in headless Chromium and
   * cannot import the TS `isGradientFill` type guard. The check below
   * mirrors lib/post-builder/canvas-editor/types.ts → `isGradientFill`
   * exactly. If the main-app guard changes shape, mirror the change
   * here. Both sides MUST agree on the discriminator.
   */
  function isGradientFill(fill) {
    if (!fill || typeof fill !== "object") return false;
    if (fill.kind !== "linear" && fill.kind !== "radial") return false;
    if (!Array.isArray(fill.stops) || fill.stops.length < 2) return false;
    return true;
  }

  /**
   * Build a Fabric Gradient instance from a structured GradientFill, in
   * the LAYER's local coordinate space (0,0 → width,height). Mirrors
   * `fabricGradientFromFill` in CanvasEditor.tsx — keep the math in sync.
   *
   * why duplicated math (and not a shared module): the worker is a
   * separate npm project; CanvasEditor.tsx imports React + Fabric ESM.
   * This file is plain ES5-ish JS loaded by Playwright via a page-eval
   * shim that cannot resolve TS-built imports. The drift risk is small
   * (the math is ~10 lines) and the inline copy keeps the worker's
   * "browser bundle" zero-dependency.
   *
   * @param {object} gradient — GradientFillLinear | GradientFillRadial
   * @param {{width:number,height:number}} bbox — layer dimensions
   * @returns {fabric.Gradient}
   */
  function fabricGradientFromFill(gradient, bbox) {
    var colorStops = gradient.stops.map(function (s) {
      return { offset: s.offset, color: s.color };
    });
    if (gradient.kind === "linear") {
      var angleRad = (gradient.angleDeg * Math.PI) / 180;
      var dx = Math.cos(angleRad);
      var dy = Math.sin(angleRad);
      var cx = bbox.width / 2;
      var cy = bbox.height / 2;
      var halfExtent = (Math.abs(dx) * bbox.width + Math.abs(dy) * bbox.height) / 2;
      return new fabric.Gradient({
        type: "linear",
        coords: {
          x1: cx - dx * halfExtent,
          y1: cy - dy * halfExtent,
          x2: cx + dx * halfExtent,
          y2: cy + dy * halfExtent,
        },
        colorStops: colorStops,
      });
    }
    // radial
    var spread = gradient.spread != null ? gradient.spread : 1;
    var rcx = bbox.width / 2;
    var rcy = bbox.height / 2;
    var radius = (Math.max(bbox.width, bbox.height) * spread) / 2;
    return new fabric.Gradient({
      type: "radial",
      coords: {
        x1: rcx,
        y1: rcy,
        r1: 0,
        x2: rcx,
        y2: rcy,
        r2: radius,
      },
      colorStops: colorStops,
    });
  }

  function addShapeLayer(canvas, layer) {
    // why: resolve fill BEFORE building `common`. Gradients are constructed
    // in the layer's local coordinate system; strings pass through. An
    // empty / missing fill falls back to "" so Fabric paints nothing —
    // matches the canvas-editor convention.
    var resolvedFill;
    if (isGradientFill(layer.fill)) {
      resolvedFill = fabricGradientFromFill(layer.fill, {
        width: layer.width,
        height: layer.height,
      });
    } else {
      resolvedFill = layer.fill || "";
    }

    var common = {
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      angle: layer.angle || 0,
      opacity: layer.opacity != null ? layer.opacity : 1,
      fill: resolvedFill,
      stroke: layer.stroke || "",
      strokeWidth: layer.strokeWidth || 0,
      strokeDashArray:
        Array.isArray(layer.strokeDashArray) && layer.strokeDashArray.length > 0
          ? layer.strokeDashArray
          : null,
      selectable: false,
      evented: false,
    };

    var obj;
    switch (layer.shapeType) {
      case "circle":
        obj = new fabric.Circle(
          Object.assign({}, common, { radius: Math.min(layer.width, layer.height) / 2 }),
        );
        break;
      case "ellipse":
        obj = new fabric.Ellipse(
          Object.assign({}, common, { rx: layer.width / 2, ry: layer.height / 2 }),
        );
        break;
      case "line":
        // Fabric Line is positioned by its x1/y1/x2/y2 coords. We model
        // a line as a horizontal stroke inside the bounding box, then
        // let `angle` rotate it.
        // why fallback to a string for the line stroke: lines paint via
        // `stroke`, not `fill` — a gradient FILL on a line is invisible.
        // If the only color the author provided is a gradient, we degrade
        // gracefully to white so the line is still visible.
        var lineStroke = layer.stroke;
        if (!lineStroke) {
          lineStroke = typeof layer.fill === "string" && layer.fill
            ? layer.fill
            : "#FFFFFF";
        }
        obj = new fabric.Line(
          [
            layer.left,
            layer.top + layer.height / 2,
            layer.left + layer.width,
            layer.top + layer.height / 2,
          ],
          Object.assign({}, common, { stroke: lineStroke }),
        );
        break;
      case "rect":
      default:
        obj = new fabric.Rect(
          Object.assign({}, common, {
            rx: layer.cornerRadius || 0,
            ry: layer.cornerRadius || 0,
          }),
        );
    }
    canvas.add(obj);
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Photo scene rendering (Ken-Burns)
  // -------------------------------------------------------------------------
  /**
   * Compute the source crop rect (in pixels, into the source photo) for
   * a given frame. The motion path defines startRect → endRect in
   * normalized (0..1) coordinates; we lerp via the easing curve.
   *
   * @param {{startRect:object,endRect:object,easing:string}} motion
   * @param {number} frameIndex
   * @param {number} totalFrames
   * @param {number} natW source photo width
   * @param {number} natH source photo height
   * @returns {{sx:number,sy:number,sw:number,sh:number}}
   */
  function computePhotoCrop(motion, frameIndex, totalFrames, natW, natH) {
    // why this guard: a 1-frame scene (totalFrames=1) would divide by
    // zero. Treat singleton scenes as "the start rect, no animation".
    var rawT = totalFrames <= 1 ? 0 : frameIndex / (totalFrames - 1);
    var ease = EASING[motion.easing] || EASING.linear;
    var t = ease(Math.max(0, Math.min(1, rawT)));
    var rect = lerpRect(motion.startRect, motion.endRect, t);
    return {
      sx: rect.x * natW,
      sy: rect.y * natH,
      sw: rect.w * natW,
      sh: rect.h * natH,
    };
  }

  /**
   * Compute object-fit: cover placement of a source rect (sw×sh) inside
   * a destination canvas (dw×dh). Returns top/left + scaleX/scaleY so
   * Fabric can position a single fabric.Image and we don't need to draw
   * twice.
   *
   * @param {number} sw source content width
   * @param {number} sh source content height
   * @param {number} dw destination width
   * @param {number} dh destination height
   */
  function computeCoverRect(sw, sh, dw, dh) {
    var scale = Math.max(dw / sw, dh / sh);
    var renderedW = sw * scale;
    var renderedH = sh * scale;
    return {
      left: (dw - renderedW) / 2,
      top: (dh - renderedH) / 2,
      scaleX: scale,
      scaleY: scale,
    };
  }

  /**
   * Render one frame of a photo scene with Ken-Burns motion.
   *
   * Implementation approach: we draw the FULL photo into the Fabric
   * canvas, then compute the visible viewport via the motion path's
   * lerped rect. The visible viewport is the crop rectangle in source
   * pixels; we scale it up to fill 1080×1920 cover-style and offset the
   * image accordingly.
   *
   * Concretely: if motion crops to a 540×960 region of the source, the
   * resulting fabric.Image is scaled so that 540×960 region exactly
   * fills 1080×1920 (2× zoom), and the image is offset so the crop's
   * top-left lands at the canvas's top-left.
   *
   * @param {string} photoUrl
   * @param {{startRect:object,endRect:object,easing:string}} motion
   * @param {number} frameIndex
   * @param {number} totalFrames
   */
  function renderPhotoScene(photoUrl, motion, frameIndex, totalFrames) {
    var canvas = resetCanvas("#000000");
    return loadImage(photoUrl).then(function (img) {
      var natW = img.naturalWidth || img.width;
      var natH = img.naturalHeight || img.height;
      if (natW <= 0 || natH <= 0) {
        return;
      }

      // 2026-06-05 — cover + pan-across + gentle-zoom (must stay in lockstep
      // with ReelPreview.drawPhotoScene). Cover-fit the FULL photo to the
      // frame (uniform scale, no distortion, no bars), then pan across the
      // overflow axis while zooming in slightly. For a landscape photo the
      // overflow is horizontal, so the camera sweeps across the full width.
      // The motion preset only encodes pan DIRECTION (sign of the x/y delta);
      // magnitude is ignored — we always traverse the full overflow.
      var rawT = totalFrames <= 1 ? 0 : frameIndex / (totalFrames - 1);
      var ease = EASING[motion.easing] || EASING.linear;
      var p = ease(Math.max(0, Math.min(1, rawT)));

      var KEN_ZOOM = 1.08;
      var baseScale = Math.max(CANVAS_WIDTH / natW, CANVAS_HEIGHT / natH);
      var scale = baseScale * (1 + (KEN_ZOOM - 1) * p);
      var renderedW = natW * scale;
      var renderedH = natH * scale;
      var overflowX = renderedW - CANVAS_WIDTH;
      var overflowY = renderedH - CANVAS_HEIGHT;

      var dx = motion.endRect.x - motion.startRect.x;
      var dy = motion.endRect.y - motion.startRect.y;

      var left, top;
      if (overflowX >= overflowY) {
        var fX = dx >= 0 ? p : 1 - p;
        left = -fX * overflowX;
        top = -overflowY / 2;
      } else {
        var fY = dy >= 0 ? p : 1 - p;
        top = -fY * overflowY;
        left = -overflowX / 2;
      }

      var fImg = new fabric.Image(img, {
        left: left,
        top: top,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
      });
      canvas.add(fImg);
      canvas.renderAll();
    }).catch(function (err) {
      // why a black frame instead of rejecting: one dead or timed-out
      // photo URL should degrade that scene, not fail the whole job.
      // The canvas was reset to black above, so rendering it as-is
      // yields a clean black frame (matches the design-scene path's
      // skip-with-warn discipline).
      console.warn("Photo scene fell back to a black frame: " + err.message);
      canvas.renderAll();
    });
  }

  // -------------------------------------------------------------------------
  // Entry point — dispatch on scene.kind
  // -------------------------------------------------------------------------
  /**
   * Render a single frame and return a data URL.
   *
   * Accepts the FULL Scene JSON (not just SceneContent) so the page can
   * read scene.content.kind for dispatch and any future per-scene config
   * (transitions etc.) without renaming the bridge contract.
   *
   * For "design" scenes, `scene.content` is expected to carry a
   * CanvasTemplateSchema-shaped `schema` field IN ADDITION to its
   * `templateRef`. The TS render driver resolves `templateRef` → schema
   * before calling into the page. // why: SceneContent only types
   * templateRef as a string (it's a stable identifier); the actual
   * schema is composition metadata the orchestrator hydrates.
   *
   * @param {object} scene
   * @param {number} frameIndex
   * @param {number} totalFrames
   * @returns {Promise<string>} data URL
   */
  // -------------------------------------------------------------------------
  // Text overlays (2026-06-05)
  // -------------------------------------------------------------------------
  // Mirror of lib/post-builder/reel-templates/text-overlay.ts TEXT_OVERLAY_PRESETS
  // and ReelPreview.drawTextOverlay — keep visually in lockstep so the baked
  // MP4 matches the editor preview.
  var TEXT_OVERLAY_PRESETS = {
    headline: {
      fontFamily: "Kaushan Script",
      weight: 400,
      color: "#FFFFFF",
      shadow: { color: "rgba(0,0,0,0.45)", blur: 28, offsetY: 6 },
    },
    gold_bar: {
      fontFamily: "Nunito",
      weight: 700,
      color: "#252526",
      background: { color: "#C9A84C", padX: 36, padY: 18, radius: 999 },
    },
    outline: {
      fontFamily: "Nunito",
      weight: 800,
      color: "#FFFFFF",
      outline: { color: "#252526", width: 6 },
    },
    subtle: {
      fontFamily: "Nunito",
      weight: 600,
      color: "#FFFFFF",
      shadow: { color: "rgba(0,0,0,0.5)", blur: 14, offsetY: 3 },
    },
  };

  function ovEaseOutCubic(t) {
    var u = 1 - t;
    return 1 - u * u * u;
  }
  function ovEaseOutBack(t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    var u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  }

  /** Draw a scene's animated text overlays onto the Fabric canvas (on top of
   *  the already-rendered scene content), at this frame's animation state. */
  function renderTextOverlays(canvas, scene, frameIndex, totalFrames) {
    var overlays = scene && scene.textOverlays;
    if (!overlays || !overlays.length) return;
    var intra = totalFrames <= 1 ? 1 : frameIndex / (totalFrames - 1);
    var elapsedMs = intra * (scene.durationMs || 0);

    for (var i = 0; i < overlays.length; i++) {
      var ov = overlays[i];
      var spec = TEXT_OVERLAY_PRESETS[ov.preset] || TEXT_OVERLAY_PRESETS.subtle;
      var p =
        ov.animationMs > 0
          ? Math.max(0, Math.min(1, elapsedMs / ov.animationMs))
          : 1;

      var alpha = 1;
      var dy = 0;
      var scale = 1;
      if (ov.animation === "fade") {
        alpha = p;
      } else if (ov.animation === "rise") {
        alpha = p;
        dy = (1 - ovEaseOutCubic(p)) * (ov.fontSize * 0.55);
      } else if (ov.animation === "pop") {
        alpha = Math.min(1, p * 1.6);
        scale = ovEaseOutBack(p);
      }
      alpha = Math.max(0, Math.min(1, alpha));

      var fullText = ov.text || "";
      var shown =
        ov.animation === "typewriter"
          ? fullText.slice(0, Math.ceil(p * fullText.length))
          : fullText;

      var cx = ov.x * CANVAS_WIDTH;
      var cy = ov.y * CANVAS_HEIGHT + dy;

      var textObj = new fabric.Text(shown, {
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fontFamily: ov.fontFamily,
        fontSize: ov.fontSize,
        fontWeight: spec.weight,
        fill: ov.color,
        textAlign: ov.align || "center",
        opacity: alpha,
        selectable: false,
        evented: false,
      });
      if (spec.outline) {
        textObj.set({
          stroke: spec.outline.color,
          strokeWidth: spec.outline.width * 2,
          paintFirst: "stroke",
        });
      }
      if (spec.shadow) {
        textObj.set({
          shadow: new fabric.Shadow({
            color: spec.shadow.color,
            blur: spec.shadow.blur,
            offsetX: 0,
            offsetY: spec.shadow.offsetY,
          }),
        });
      }
      if (scale !== 1) {
        textObj.set({ scaleX: scale, scaleY: scale });
      }

      if (spec.background && shown.trim().length > 0) {
        var bg = spec.background;
        var tw = textObj.width || 0;
        var th = textObj.height || 0;
        var pillH = th + bg.padY * 2;
        var pill = new fabric.Rect({
          left: cx,
          top: cy,
          originX: "center",
          originY: "center",
          width: tw + bg.padX * 2,
          height: pillH,
          rx: Math.min(bg.radius, pillH / 2),
          ry: Math.min(bg.radius, pillH / 2),
          fill: bg.color,
          opacity: alpha,
          selectable: false,
          evented: false,
        });
        if (scale !== 1) {
          pill.set({ scaleX: scale, scaleY: scale });
        }
        canvas.add(pill);
      }
      canvas.add(textObj);
    }
    canvas.renderAll();
  }

  function renderSceneFrame(scene, frameIndex, totalFrames) {
    return document.fonts.ready.then(function () {
      var content = scene && scene.content;
      if (!content || typeof content.kind !== "string") {
        throw new Error("renderSceneFrame: scene.content.kind missing");
      }

      var work;
      if (content.kind === "design") {
        // The unified contract (2026-05-16) is `content.template` — an
        // inline CanvasTemplateSchema object embedded by VALUE so the
        // composition is self-contained. Older drafts used `templateRef`
        // (a string id); we accept `.schema` too for resilience against
        // any in-flight pre-unification clients, but new code only sends
        // `.template`.
        var schema = content.template || content.schema;
        if (!schema || typeof schema !== "object") {
          throw new Error(
            "design scene is missing `content.template` (a CanvasTemplateSchema object). " +
            "Got: " + JSON.stringify(content),
          );
        }
        work = renderDesignScene(schema);
      } else if (content.kind === "photo") {
        work = renderPhotoScene(
          content.photoUrl,
          content.motion,
          frameIndex,
          totalFrames,
        );
      } else if (content.kind === "video_clip") {
        // The worker's /render route rejects video_clip in MVP, but a
        // defense-in-depth check here means a misrouted scene fails
        // loudly instead of producing a black frame.
        throw new Error("video_clip scenes are not yet supported");
      } else {
        throw new Error("Unknown scene.content.kind: " + content.kind);
      }

      return work.then(function () {
        var canvas = getFabricCanvas();
        // Bake animated text overlays on top of the scene content for this
        // frame (matches the editor preview's drawTextOverlay).
        renderTextOverlays(canvas, scene, frameIndex, totalFrames);
        return canvas.toDataURL({
          format: "png",
          multiplier: 1,
        });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Single-template render — unified path for /render-image
  // -------------------------------------------------------------------------
  //
  // why this exists alongside renderSceneFrame: design-kind scenes in the
  // video pipeline expect every layer to already be HYDRATED upstream —
  // i.e., resolvedText / resolvedSrc are set by the main app before the
  // composition is submitted. The new /render-image endpoint takes a RAW
  // CanvasTemplateSchema (with boundField pointers but no resolved values)
  // plus an MLSListingPayload, so this bridge function hydrates structurally
  // before delegating to renderDesignScene.
  //
  // Keeping hydration here (not on the worker's Node side) makes the
  // surface uniform: the page is the single place where templates become
  // pixels, and every boundField-driven feature evolves in one file.
  //
  // The hydration MIRRORS lib/post-builder/canvas-editor/CanvasEditor.tsx's
  // resolveTextBoundField / resolveImageBoundField. If a new TextBoundField
  // or ImageBoundField is added to the main app's union, mirror it here.
  // The drift would only matter for /render-image renders — the video
  // pipeline path is unaffected because design scenes ship pre-hydrated.

  /** Format a number as a US-locale price string. Empty when null. */
  function formatPriceUSD(value) {
    if (value == null || typeof value !== "number" || !isFinite(value)) {
      return "";
    }
    // why Intl.NumberFormat over manual ",": same path the main app uses,
    // so price strings round-trip identically between client preview and
    // server render.
    return "$" + new Intl.NumberFormat("en-US").format(Math.round(value));
  }

  /** "4 BR / 3 BA" — beds + (full + half/2) baths. Empty when both are null. */
  function formatBedsBaths(beds, full, half) {
    var bedsStr = typeof beds === "number" ? String(beds) + " BR" : "";
    var totalBaths =
      (typeof full === "number" ? full : 0) +
      (typeof half === "number" ? half * 0.5 : 0);
    var bathsStr = totalBaths > 0 ? String(totalBaths) + " BA" : "";
    if (bedsStr && bathsStr) return bedsStr + " / " + bathsStr;
    return bedsStr || bathsStr;
  }

  // Brand logo fallbacks — MUST mirror
  // lib/post-builder/canvas-editor/templates/brand-logos.ts and the
  // price-tier rule in fabric-factory.ts (EXCELLENCE_PRICE_THRESHOLD in
  // lib/post-builder/excellence-collection.ts). If either changes in the
  // main app, mirror the change here.
  var C21_ALLIANCE_WHITE_LOGO_URL =
    "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/1243286b-f208-47fb-a8f3-7fa1367951a2.png";
  var EXCELLENCE_COLLECTION_LOGO_URL =
    "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/488d325e-10d2-40ce-92bc-1a4ce9ef9370.png";
  var EXCELLENCE_PRICE_THRESHOLD = 949000;

  /** Mirror lib/post-builder/canvas-editor/CanvasEditor.tsx STATUS_LABEL_MAP. */
  var STATUS_LABEL_MAP = {
    active: "JUST LISTED",
    pending: "UNDER CONTRACT",
    sold: "JUST SOLD",
    expired: "",
    coming_soon: "COMING SOON",
  };

  // Open-house date/time formatters — PINNED to America/New_York
  // (2026-07-23). why: this file runs in headless Chromium whose clock is
  // UTC; formatting without an explicit timeZone printed UTC wall time on
  // published slides ("4:00 PM – 6:00 PM" for a 12–2 PM open house).
  // Mirrors fabric-factory.ts's formatOpenHouseDate / TimeRange exactly.
  var OPEN_HOUSE_DATE_FMT = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
  var OPEN_HOUSE_TIME_FMT = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  function formatOpenHouseDateET(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return OPEN_HOUSE_DATE_FMT.format(d);
  }

  function formatOpenHouseTimeRangeET(startIso, endIso) {
    if (!startIso) return "";
    var start = new Date(startIso);
    if (isNaN(start.getTime())) return "";
    var startStr = OPEN_HOUSE_TIME_FMT.format(start);
    if (!endIso) return startStr;
    var end = new Date(endIso);
    if (isNaN(end.getTime())) return startStr;
    // en-dash per C21 brand style, same as fabric-factory.ts.
    return startStr + " – " + OPEN_HOUSE_TIME_FMT.format(end);
  }

  /**
   * Resolve a TextBoundField against an MLSListingPayload-shaped object.
   * Returns empty string for unknown fields rather than throwing — keeps
   * the render robust against client/server drift.
   */
  function resolveTextBoundField(field, listing) {
    if (!listing) return "";
    switch (field) {
      case "price":
        return formatPriceUSD(listing.priceList);
      case "close_price":
        return formatPriceUSD(listing.priceClose);
      case "address_line1":
        return listing.addressLine1 || "";
      case "city_state_zip": {
        var parts = [listing.city, listing.state, listing.zip].filter(Boolean);
        if (parts.length < 2) return parts.join(" ");
        var city = parts[0];
        var state = parts[1];
        var zip = parts[2];
        return zip ? city + ", " + state + " " + zip : city + ", " + state;
      }
      case "city":
        return listing.city || "";
      case "state":
        return listing.state || "";
      case "zip":
        return listing.zip || "";
      case "beds":
        return typeof listing.beds === "number" ? String(listing.beds) : "";
      case "baths": {
        var total =
          (typeof listing.bathsFull === "number" ? listing.bathsFull : 0) +
          (typeof listing.bathsHalf === "number"
            ? listing.bathsHalf * 0.5
            : 0);
        return total > 0 ? String(total) : "";
      }
      case "beds_baths":
        return formatBedsBaths(
          listing.beds,
          listing.bathsFull,
          listing.bathsHalf,
        );
      case "property_type":
        return listing.propertyType || "";
      case "mls_number":
        return listing.mlsNumber || "";
      case "tagline":
        return listing.tagline || "";
      case "status_label":
        return STATUS_LABEL_MAP[listing.status] || "";
      case "agent_name":
        return listing.agentName || "";
      case "agent_phone":
        return listing.agentPhone || "";
      case "agent_email":
        return listing.agentEmail || "";
      case "agent_title":
        return listing.agentTitle || "";
      case "office_name":
        return listing.officeName || "";
      case "open_house_date":
        // 2026-07-23 — real formatting (Eastern-pinned), replacing the old
        // raw-ISO fallback that leaked ISO strings onto rendered slides.
        return formatOpenHouseDateET(listing.openHouseStartUtc);
      case "open_house_time":
        return formatOpenHouseTimeRangeET(
          listing.openHouseStartUtc,
          listing.openHouseEndUtc,
        );
      default:
        // why: warn-not-throw matches the layer-kind dispatch — an unknown
        // field is recoverable (text just renders empty); a throw would
        // blank the whole render.
        console.warn("Unknown TextBoundField: " + field);
        return "";
    }
  }

  /**
   * Resolve an ImageBoundField against an MLSListingPayload-shaped object.
   * Returns null when the listing doesn't carry that asset; addImageLayer
   * handles null by rendering a placeholder rect.
   */
  function resolveImageBoundField(field, listing) {
    if (!listing) return null;
    var photos = Array.isArray(listing.photos) ? listing.photos : [];
    switch (field) {
      case "hero_photo":
        return photos[0] || null;
      case "photo_2":
        return photos[1] || null;
      case "photo_3":
        return photos[2] || null;
      case "photo_4":
        return photos[3] || null;
      case "photo_5":
        return photos[4] || null;
      case "agent_photo":
        return listing.agentPhotoUrl || null;
      case "office_logo":
        return listing.officeLogoUrl || null;
      case "brokerage_logo":
        // why absolute https URLs: this page loads via file://, so the
        // old app-relative "/brand/c21-mark.svg" resolved to
        // file:///brand/... (a file that does not exist anywhere, not
        // even in the app repo) and the logo silently dropped from
        // every /render-image render. Mirror the app's
        // fabric-factory.ts resolution instead: prefer the listing's
        // resolved brokerageLogoUrl, then the price-tier brand
        // constants below (Supabase Storage public URLs load fine
        // under file:// with anonymous CORS).
        if (listing.brokerageLogoUrl) return listing.brokerageLogoUrl;
        if (
          typeof listing.priceList === "number" &&
          listing.priceList >= EXCELLENCE_PRICE_THRESHOLD
        ) {
          return EXCELLENCE_COLLECTION_LOGO_URL;
        }
        return C21_ALLIANCE_WHITE_LOGO_URL;
      default:
        console.warn("Unknown ImageBoundField: " + field);
        return null;
    }
  }

  /**
   * Walk a template's layers and produce a copy whose text/image layers
   * carry resolvedText / resolvedSrc populated from the listing. Group
   * layers recurse so nested templates hydrate too. Layers without a
   * boundField are passed through unchanged.
   *
   * Pure function: never mutates the input. The video pipeline relies on
   * the same property — design-scene templates are persisted by value in
   * the composition and must remain stable across renders.
   */
  function hydrateTemplate(template, listing) {
    if (!template || !Array.isArray(template.layers)) return template;
    var hydratedLayers = template.layers.map(function (layer) {
      if (!layer || typeof layer !== "object") return layer;
      if (layer.kind === "text" && layer.boundField) {
        var resolved = resolveTextBoundField(layer.boundField, listing);
        // why: only inject resolvedText when the field resolves to a
        // non-empty string; falling back to layer.text otherwise mirrors
        // the editor's behavior (literal text is the fallback).
        return Object.assign({}, layer, {
          resolvedText: resolved !== "" ? resolved : layer.text,
        });
      }
      if (layer.kind === "image" && layer.boundField) {
        var src = resolveImageBoundField(layer.boundField, listing);
        return Object.assign({}, layer, { resolvedSrc: src });
      }
      if (layer.kind === "group" && Array.isArray(layer.children)) {
        return Object.assign({}, layer, {
          children: hydrateTemplate(
            { layers: layer.children },
            listing,
          ).layers,
        });
      }
      return layer;
    });
    return Object.assign({}, template, { layers: hydratedLayers });
  }

  /**
   * Render ONE canvas-editor template into a PNG dataURL. Called by the
   * worker's POST /render-image endpoint via Playwright's page.evaluate.
   *
   * The flow is: hydrate boundField pointers → delegate to renderDesignScene
   * (the same code path video design-scenes use) → toDataURL.
   *
   * @param {object} template — structurally a CanvasTemplateSchema.
   * @param {object} listing — structurally an MLSListingPayload.
   * @returns {Promise<string>} data URL.
   */
  function renderTemplateFrame(template, listing) {
    return document.fonts.ready.then(function () {
      if (!template || typeof template !== "object") {
        throw new Error(
          "renderTemplateFrame: template is required and must be an object",
        );
      }
      var hydrated = hydrateTemplate(template, listing);
      return renderDesignScene(hydrated).then(function () {
        var canvas = getFabricCanvas();
        return canvas.toDataURL({ format: "png", multiplier: 1 });
      });
    });
  }

  // Expose the API the Playwright driver calls.
  globalScope.renderSceneFrame = renderSceneFrame;
  globalScope.renderTemplateFrame = renderTemplateFrame;
  // Diagnostic helpers — useful when manually opening the page in a
  // browser tab to debug. Not part of the contract.
  globalScope.__alliance_render = {
    canvas: getFabricCanvas,
    lerpRect: lerpRect,
    EASING: EASING,
    hydrateTemplate: hydrateTemplate,
    resolveTextBoundField: resolveTextBoundField,
    resolveImageBoundField: resolveImageBoundField,
  };
})(window);
