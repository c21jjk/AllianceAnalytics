/**
 * Alliance Social · AutoReel Helper — content script (2026-08-05)
 * ---------------------------------------------------------------------------
 * Runs on autoreelapp.com. Two jobs:
 *
 * 1. AUTO-CREATE. When Alliance Social opens AutoReel with a `#asa=` payload
 *    (listing MLS + address), this script drives the create wizard:
 *      Create → type project name → Next → type address → click the
 *      suggestion → Import → "Use this listing"
 *    ...then STOPS so the human picks photos. On success it also reports the
 *    new project URL back to Alliance Social (background.js) so the listing's
 *    AutoReel button deep-links to the project forever.
 *
 * 2. SEND BUTTON. On any project page with a finished render, injects a
 *    "Send to Alliance Social" button next to the video that opens the
 *    /autoreel/handoff page with the video URL — no right-click needed.
 *
 * Design rules: never break AutoReel. Every step has a timeout; on any
 * failure we toast a note and leave the page exactly as a human would find
 * it (the address is already on the clipboard as fallback). All state lives
 * in sessionStorage so full-page navigations inside the wizard resume.
 */

"use strict";

const APP_ORIGIN = "https://www.alliancesocialanalytics.com";
const PAYLOAD_KEY = "asa_autoreel_payload";
const PAYLOAD_TTL_MS = 15 * 60 * 1000;
const STEP_TIMEOUT_MS = 30 * 1000;
const TICK_MS = 400;

/* ------------------------------------------------------------------ */
/* Payload capture — run_at document_start so the SPA router can't     */
/* swallow the fragment before we see it.                              */
/* ------------------------------------------------------------------ */
(function capturePayload() {
  try {
    const hash = window.location.hash || "";
    const m = hash.match(/#asa=(.+)$/);
    if (!m) return;
    const parsed = JSON.parse(decodeURIComponent(m[1]));
    if (!parsed || parsed.v !== 1 || !parsed.address) return;
    parsed.stage = "create";
    parsed.stageAt = Date.now();
    sessionStorage.setItem(PAYLOAD_KEY, JSON.stringify(parsed));
    // Clean the URL so a reload doesn't re-trigger.
    history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch (e) {
    /* never break the page */
  }
})();

function loadPayload() {
  try {
    const raw = sessionStorage.getItem(PAYLOAD_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.ts || Date.now() - p.ts > PAYLOAD_TTL_MS) {
      sessionStorage.removeItem(PAYLOAD_KEY);
      return null;
    }
    return p;
  } catch (e) {
    return null;
  }
}

function savePayload(p) {
  try {
    sessionStorage.setItem(PAYLOAD_KEY, JSON.stringify(p));
  } catch (e) {
    /* ignore */
  }
}

function clearPayload() {
  try {
    sessionStorage.removeItem(PAYLOAD_KEY);
  } catch (e) {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

/** Set an input's value the way React expects (native setter + input event). */
function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findButton(text) {
  const want = text.toLowerCase();
  return [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim().toLowerCase() === want
  );
}

/** Full click sequence — many React handlers listen on mousedown. */
function realClick(el) {
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.click();
}

function toast(message, ok) {
  try {
    const id = "asa-toast";
    document.getElementById(id)?.remove();
    const el = document.createElement("div");
    el.id = id;
    el.textContent = message;
    el.style.cssText = [
      "position:fixed",
      "bottom:20px",
      "right:20px",
      "z-index:2147483647",
      "max-width:340px",
      "padding:10px 14px",
      "border-radius:8px",
      "font:500 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "box-shadow:0 4px 16px rgba(0,0,0,.18)",
      ok
        ? "background:#1c1c1d;color:#e8d9ae;border:1px solid #C9A84C"
        : "background:#fff7ed;color:#7c2d12;border:1px solid #fdba74",
    ].join(";");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 7000);
  } catch (e) {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Job 1 — the create-wizard state machine                             */
/* ------------------------------------------------------------------ */

function advance(p, stage) {
  p.stage = stage;
  p.stageAt = Date.now();
  savePayload(p);
}

function failOut(p, why) {
  clearPayload();
  toast(
    "Alliance Social helper: " +
      why +
      " Finish manually — the address is already on your clipboard.",
    false
  );
}

function tick() {
  const p = loadPayload();
  if (!p || p.stage === "done") return;

  if (Date.now() - (p.stageAt || p.ts) > STEP_TIMEOUT_MS) {
    failOut(p, "couldn't finish the '" + p.stage + "' step automatically.");
    return;
  }

  const url = window.location.href;

  switch (p.stage) {
    case "create": {
      // Already inside the wizard (e.g. resumed after a reload)?
      if (/\/project\/\d+/.test(url) && url.includes("step=upload")) {
        advance(p, "address");
        return;
      }
      // Name modal open? Fill + Next.
      const nameInput = document.querySelector('input[placeholder="1234 Main St"]');
      if (nameInput) {
        if ((nameInput.value || "").trim() !== p.name) {
          setNativeValue(nameInput, p.name);
          return; // let React settle one tick before clicking Next
        }
        const next = findButton("next");
        if (next && !next.disabled) {
          realClick(next);
          advance(p, "address");
        }
        return;
      }
      // Otherwise, open the modal via the sidebar Create button.
      const create = findButton("create");
      if (create) realClick(create);
      return;
    }

    case "address": {
      if (!(/\/project\/\d+/.test(url) && url.includes("step=upload"))) return;
      const addr = document.querySelector(
        'input[placeholder="Enter a property address"]'
      );
      if (!addr) return;
      if ((addr.value || "").trim() === "") {
        addr.focus();
        setNativeValue(addr, p.address);
        return;
      }
      // Wait for the autocomplete and click the first suggestion. Suggestion
      // rows end in ", USA" (Google-places style). Keep the match tight so we
      // never click page copy by accident.
      const nodes = [...document.querySelectorAll("div,li,p,span")].filter((el) => {
        if (el.childElementCount > 3) return false;
        const t = (el.textContent || "").trim();
        return t.length > 8 && t.length < 140 && /,\s*USA$/.test(t) && !el.contains(addr);
      });
      if (nodes.length > 0) {
        // Innermost match's clickable row = its closest option-ish ancestor.
        const target = nodes[0].closest('[role="option"]') || nodes[0];
        realClick(target);
        advance(p, "import");
      }
      return;
    }

    case "import": {
      const imp = findButton("import");
      if (imp && !imp.disabled) {
        realClick(imp);
        advance(p, "choose");
      }
      return;
    }

    case "choose": {
      const use = findButton("use this listing");
      if (use && !use.disabled) {
        realClick(use);
        // Report the project link home (best-effort) and finish.
        const m = window.location.pathname.match(/\/project\/(\d+)/);
        if (m && p.mls) {
          try {
            chrome.runtime.sendMessage({
              type: "save_project_link",
              mls_number: p.mls,
              project_url: "https://www.autoreelapp.com/listings/" + m[1],
            });
          } catch (e) {
            /* ignore */
          }
        }
        advance(p, "done");
        toast(
          "Alliance Social: project created and photos imported. Pick your shots, keep Landscape, then Render.",
          true
        );
        setTimeout(clearPayload, 5000);
      }
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Job 2 — "Send to Alliance Social" on finished videos                */
/* ------------------------------------------------------------------ */

function injectSendButtons() {
  const videos = document.querySelectorAll(
    'video[src*="media.autoreelapp.com/renders"]'
  );
  videos.forEach((video) => {
    if (video.dataset.asaSend) return;
    video.dataset.asaSend = "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "⟶ Send to Alliance Social";
    btn.style.cssText = [
      "display:block",
      "margin:8px 0 0",
      "padding:8px 14px",
      "border-radius:8px",
      "border:none",
      "cursor:pointer",
      "background:#C9A84C",
      "color:#fff",
      "font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";");
    btn.addEventListener("click", () => {
      const videoUrl = (video.currentSrc || video.src || "").split("#")[0];
      const title = (document.querySelector("h1")?.textContent || "").trim();
      const params = new URLSearchParams({
        video: videoUrl,
        project: window.location.href.split("#")[0],
        title,
      });
      window.open(APP_ORIGIN + "/autoreel/handoff?" + params.toString(), "_blank");
    });
    video.insertAdjacentElement("afterend", btn);
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function start() {
  setInterval(() => {
    try {
      tick();
      injectSendButtons();
    } catch (e) {
      /* the helper must never break AutoReel */
    }
  }, TICK_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
