import { createElement as h } from "react";
import type { ReactNode } from "react";
export interface NavItem { href: string; label: string; icon: ReactNode; adminOnly?: boolean; }
const SVG_PROPS = { viewBox: "0 0 24 24", fill: "none", className: "w-5 h-5", "aria-hidden": "true" };
const STROKE = { stroke: "currentColor", strokeWidth: 1.5 };
const ICON: Record<string, ReactNode> = {
    dashboard: h("svg", SVG_PROPS, h("path", { d: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10", ...STROKE, strokeLinecap: "round", strokeLinejoin: "round" })),
    posts: h("svg", SVG_PROPS, [h("rect", { key: "r", x: "3.5", y: "4.5", width: "17", height: "15", rx: "2.5", ...STROKE }), h("path", { key: "p", d: "M3.5 10h17M8 4.5v15", ...STROKE, strokeLinecap: "round" })]),
    properties: h("svg", SVG_PROPS, h("path", { d: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1v-9z", ...STROKE, strokeLinejoin: "round" })),
    reports: h("svg", SVG_PROPS, [h("path", { key: "p1", d: "M6 3.5h9l4 4V20a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z", ...STROKE, strokeLinejoin: "round" }), h("path", { key: "p2", d: "M14.5 3.5V8h4M9 13h6M9 17h4", ...STROKE, strokeLinecap: "round" })]),
    settings: h("svg", SVG_PROPS, [h("circle", { key: "c", cx: "12", cy: "12", r: "3", ...STROKE }), h("path", { key: "p", d: "M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1A2 2 0 114.3 17l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1A2 2 0 117 4.3l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z", ...STROKE, strokeLinejoin: "round" })]),
};
export function getNavItems(role: "admin" | "user"): NavItem[] {
    const base: NavItem[] = [
        { href: "/", label: "Dashboard", icon: ICON.dashboard },
        { href: "/posts", label: "Posts", icon: ICON.posts },
        { href: "/properties", label: "Properties", icon: ICON.properties },
        { href: "/reports", label: "Reports", icon: ICON.reports },
        { href: "/settings", label: "Settings", icon: ICON.settings, adminOnly: true },
        ];
    return base.filter(function (i) { return !i.adminOnly || role === "admin"; });
}
