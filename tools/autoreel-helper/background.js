/**
 * Alliance Social · AutoReel Helper — background worker (2026-08-05)
 *
 * One job: when the content script finishes auto-creating a project, save
 * the project link back to Alliance Social so the listing's AutoReel button
 * deep-links straight to it. Runs from the extension context because a
 * cross-origin fetch from the AutoReel page would be blocked; extension
 * requests to hosts in host_permissions carry the user's Alliance Social
 * session cookies. Best-effort — failures are logged, never surfaced.
 */

"use strict";

const APP_ORIGIN = "https://www.alliancesocialanalytics.com";

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "save_project_link") return;
  if (!msg.mls_number || !msg.project_url) return;
  fetch(APP_ORIGIN + "/api/post-builder/autoreel-import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "save_project_link",
      mls_number: msg.mls_number,
      project_url: msg.project_url,
    }),
  }).catch((e) => {
    console.warn("[asa-helper] save_project_link failed:", e);
  });
});
