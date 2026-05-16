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

  /**
   * Load an image with anonymous CORS, returning a Promise that resolves
   * to the HTMLImageElement once it's decoded.
   *
   * @param {string} url
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(url) {
    if (imageCache[url]) return imageCache[url];

    var p = new Promise(function (resolve, reject) {
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

  function addTextLayer(canvas, layer) {
    // why Textbox over IText: Textbox supports `width`-based wrapping
    // which mirrors the canvas-editor's `maxWidth` behaviour. IText
    // would honor newlines only.
    var text = layer.resolvedText != null ? layer.resolvedText : layer.text;
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

  function addShapeLayer(canvas, layer) {
    var common = {
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      angle: layer.angle || 0,
      opacity: layer.opacity != null ? layer.opacity : 1,
      fill: layer.fill || "",
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
        obj = new fabric.Line(
          [
            layer.left,
            layer.top + layer.height / 2,
            layer.left + layer.width,
            layer.top + layer.height / 2,
          ],
          Object.assign({}, common, { stroke: layer.stroke || layer.fill || "#FFFFFF" }),
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

      var crop = computePhotoCrop(motion, frameIndex, totalFrames, natW, natH);

      // Compute the cover-fit of the cropped region into 1080×1920.
      // Because cropped region (sw×sh) and dest (1080×1920) usually
      // share the 9:16 aspect ratio (presets pick rects that do), this
      // simplifies to a uniform scale. We use computeCoverRect anyway
      // so non-9:16 crops degrade gracefully.
      var cover = computeCoverRect(crop.sw, crop.sh, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Offset the image so the crop's TOP-LEFT lands at the cover's
      // TOP-LEFT. The crop is at (sx, sy) in source pixels; once
      // scaled by `cover.scaleX`, the image's top-left in canvas
      // pixels is at `cover.left - crop.sx * cover.scaleX`.
      var fImg = new fabric.Image(img, {
        left: cover.left - crop.sx * cover.scaleX,
        top: cover.top - crop.sy * cover.scaleY,
        scaleX: cover.scaleX,
        scaleY: cover.scaleY,
        selectable: false,
        evented: false,
      });
      canvas.add(fImg);
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
        return canvas.toDataURL({
          format: "png",
          multiplier: 1,
        });
      });
    });
  }

  // Expose the API the Playwright driver calls.
  globalScope.renderSceneFrame = renderSceneFrame;
  // Diagnostic helpers — useful when manually opening the page in a
  // browser tab to debug. Not part of the contract.
  globalScope.__alliance_render = {
    canvas: getFabricCanvas,
    lerpRect: lerpRect,
    EASING: EASING,
  };
})(window);
