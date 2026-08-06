# Alliance Social · AutoReel Helper

A tiny Chrome extension that removes the copy-paste dance between Alliance
Social and AutoReel (autoreelapp.com). Install it once per machine (John +
Larissa + anyone else who builds reels).

## What it does

1. **Auto-creates the project.** Click "Open AutoReel" on any listing in
   Alliance Social and the popup fills itself in: Create, project name,
   address, listing picked, photos imported. You take over at photo
   selection (pick shots in play order, keep Landscape, Render).
2. **One-click video handoff.** On any AutoReel project with a finished
   video, a gold "Send to Alliance Social" button appears under the video.
   Click it and the video imports itself: captions drafted, preview page
   opens, ready to publish.
3. **Saves the project link automatically** so the listing's AutoReel button
   deep-links back to the project (requires being signed in to Alliance
   Social in the same Chrome profile).

If the extension isn't installed (or ever breaks), nothing is lost: the
manual flow still works and the address is auto-copied to the clipboard.

## Install (one time, ~1 minute)

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select this folder (`tools/autoreel-helper` inside the AllianceAnalytics
   repo, or wherever this folder was copied)
5. Done. No restart needed.

## Updating

When this folder changes in the repo, go to `chrome://extensions` and click
the reload (circular arrow) icon on the extension card.

## Troubleshooting

- **Wizard doesn't auto-fill**: make sure the popup was opened from the
  "Open AutoReel" button in Alliance Social (that's what carries the listing
  info), and that the extension is enabled. Worst case, paste manually —
  the address is on your clipboard.
- **"Send to Alliance Social" opens a login page**: sign in to Alliance
  Social in this Chrome profile first, then click the button again in
  AutoReel.
- **AutoReel redesigned their site and the helper stopped working**: tell
  Claude — the selectors in `content.js` need a refresh.
