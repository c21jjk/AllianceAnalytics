import { createElement as h } from "react";
import type { ReactNode } from "react";
export interface NavItem { href: string; label: string; icon: ReactNode; adminOnly?: boolean; }
const SVG_PROPS = { viewBox: "0 0 24 24", fill: "none", className: "w-5 h-5", "aria-hidden": "true" };
const STROKE = { stroke: "currentColor", strokeWidth: 1.5 };
const ICON: Record<string, ReactNode> = {
    dashboard: h("svg", SVG_PROPS, h("path", { d: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10", ...STROKE, strokeLinecap: "round", strokeLinejoin: "round" })),
    posts: h("svg", SVG_PROPS, [h("rect", { key: "r", x: "3.5", y: "4.5", width: "17", height: "15", rx: "2.5", ...STROKE }), h("path", { key: "p", d: "M3.5 10h17M8 4.5v15", ...STROKE, strokeLinecap: "round" })]),
    properties: h("svg", SVG_PROPS, h("path", { d: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1v-9z", ...STROKE, strokeLinejoin: "round" })),
    listings: h("svg", SVG_PROPS, [h("path", { key: "tag", d: "M11 3H5a2 2 0 00-2 2v6l9 9 8-8-9-9z", ...STROKE, strokeLinejoin: "round" }), h("circle", { key: "dot", cx: "8", cy: "8", r: "1.4", fill: "currentColor" })]),
    postBuilder: h("svg", SVG_PROPS, [
        h("rect", { key: "frame", x: "3.5", y: "3.5", width: "17", height: "17", rx: "2.5", ...STROKE }),
        h("path", { key: "mountain", d: "M3.5 16l4.5-4.5 3.5 3.5 3-3 6 6", ...STROKE, strokeLinejoin: "round" }),
        h("circle", { key: "sun", cx: "16", cy: "8.5", r: "1.6", ...STROKE }),
    ]),
    coach: h(
        "svg",
        { ...SVG_PROPS, fill: "currentColor" },
        [
            h("path", { key: "spark1", d: "M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" }),
            h("path", { key: "spark2", opacity: "0.55", d: "M19 14l.7 1.8L21 16l-1.3.6L19 18l-.7-1.4L17 16l1.3-.5L19 14zM5 16l.5 1.3L7 18l-1.5.4L5 20l-.5-1.6L3 18l1.5-.4L5 16z" }),
        ],
    ),
    reports: h("svg", SVG_PROPS, [h("path", { key: "p1", d: "M6 3.5h9l4 4V20a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z", ...STROKE, strokeLinejoin: "round" }), h("path", { key: "p2", d: "M14.5 3.5V8h4M9 13h6M9 17h4", ...STROKE, strokeLinecap: "round" })]),
    stories: h("svg", SVG_PROPS, [
        h("path", { key: "book", d: "M4 5.5A1.5 1.5 0 015.5 4H11v15.5a1 1 0 00-1-1H4v-13z", ...STROKE, strokeLinejoin: "round" }),
        h("path", { key: "book2", d: "M20 5.5A1.5 1.5 0 0018.5 4H13v15.5a1 1 0 011-1h6v-13z", ...STROKE, strokeLinejoin: "round" }),
    ]),
    outbox: h("svg", SVG_PROPS, [
        h("path", { key: "inbox", d: "M3 13l3-9h12l3 9M3 13v6a1 1 0 001 1h16a1 1 0 001-1v-6M3 13h5l1 2h6l1-2h5", ...STROKE, strokeLinejoin: "round", strokeLinecap: "round" }),
    ]),
    settings: h("svg", SVG_PROPS, [h("circle", { key: "c", cx: "12", cy: "12", r: "3", ...STROKE }), h("path", { key: "p", d: "M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1A2 2 0 114.3 17l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1A2 2 0 117 4.3l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z", ...STROKE, strokeLinejoin: "round" })]),
    users: h("svg", SVG_PROPS, [
        h("circle", { key: "h1", cx: "9", cy: "8", r: "3.4", ...STROKE }),
        h("path", { key: "b1", d: "M2.5 20c1.1-3 3.7-4.6 6.5-4.6s5.4 1.6 6.5 4.6", ...STROKE, strokeLinecap: "round" }),
        h("circle", { key: "h2", cx: "17", cy: "9", r: "2.6", ...STROKE }),
        h("path", { key: "b2", d: "M14.5 16.5c.7-1.7 2.4-2.7 4.4-2.7 1.5 0 2.7.5 3.5 1.4", ...STROKE, strokeLinecap: "round" }),
    ]),
    // --- Mobile bottom-tab icons (PWA shell) ---
    create: h("svg", SVG_PROPS, [
        h("circle", { key: "c", cx: "12", cy: "12", r: "8.5", ...STROKE }),
        h("path", { key: "p", d: "M12 8.5v7M8.5 12h7", ...STROKE, strokeLinecap: "round" }),
    ]),
    track: h("svg", SVG_PROPS, [
        h("path", { key: "axis", d: "M4 4v15a1 1 0 001 1h15", ...STROKE, strokeLinecap: "round" }),
        h("path", { key: "line", d: "M7.5 15.5l3.5-4 3 2.5 4.5-6", ...STROKE, strokeLinecap: "round", strokeLinejoin: "round" }),
    ]),
    alerts: h("svg", SVG_PROPS, [
        h("path", { key: "bell", d: "M18 9.5a6 6 0 10-12 0c0 5-1.8 6.3-1.8 6.3h15.6S18 14.5 18 9.5z", ...STROKE, strokeLinecap: "round", strokeLinejoin: "round" }),
        h("path", { key: "clapper", d: "M10.3 19.5a2 2 0 003.4 0", ...STROKE, strokeLinecap: "round" }),
    ]),
};
export function getNavItems(role: "admin" | "user"): NavItem[] {
    // 2026-08-05 (John) — nav trimmed from 7 tabs to 6, ordered by the actual
    // daily workflow: see what needs doing, look up a listing, make the post,
    // check what we made, report on it, get advice.
    //
    //   Stories  → folded into Reports as a tab (?view=stories). Both answered
    //              "what did the seller get", so they were two halves of one
    //              idea competing for a slot.
    //   Posts    → NEW. /saved-posts was a real page with every post ever
    //              built, including unpublished drafts, and it was orphaned:
    //              reachable only from a small link inside the Post Builder.
    //   Outbox   → moved to the AccountMenu. Admin-only, low frequency, and
    //              still a manual mailto queue until auto-send ships.
    //
    // Users management also lives under the AccountMenu.
    const base: NavItem[] = [
        { href: "/", label: "Dashboard", icon: ICON.dashboard },
        { href: "/properties", label: "Listings", icon: ICON.listings },
        { href: "/post-builder", label: "Post Builder", icon: ICON.postBuilder },
        { href: "/saved-posts", label: "Posts", icon: ICON.posts },
        { href: "/reports", label: "Reports", icon: ICON.reports },
        { href: "/coach", label: "Coach", icon: ICON.coach },
        ];
    return base.filter(function (i) { return !i.adminOnly || role === "admin"; });
}

/**
 * Mobile bottom-tab items (phone widths only — the desktop TopNav keeps
 * the full getNavItems set). Four thumb-sized tabs matching the on-the-go
 * jobs: Home (dashboard), Create (mobile quick-create + multi-OH), Track
 * (recent-post performance), Alerts (publish results + AI performance
 * alerts, plus the push-notification opt-in).
 */
export function getMobileNavItems(_role: "admin" | "user"): NavItem[] {
    return [
        { href: "/", label: "Home", icon: ICON.dashboard },
        { href: "/m/create", label: "Create", icon: ICON.create },
        { href: "/m/track", label: "Track", icon: ICON.track },
        { href: "/m/alerts", label: "Alerts", icon: ICON.alerts },
    ];
}
