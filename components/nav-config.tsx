import type React from "react";

export interface NavItem {
    href: string;
    label: string;
    icon: React.ReactNode;
    adminOnly?: boolean;
}

const ICON: Record<string, React.ReactNode> = {
    dashboard: (
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>svg>
        ),
    posts: (
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth={1.5} />
                <path d="M3.5 10h17M8 4.5v15" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          </svg>svg>
        ),
    properties: (
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1v-9z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
          </svg>svg>
        ),
    reports: (
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M6 3.5h9l4 4V20a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
                <path d="M14.5 3.5V8h4M9 13h6M9 17h4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          </svg>svg>
        ),
    settings: (
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth={1.5} />
                <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1A2 2 0 114.3 17l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1A2 2 0 117 4.3l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
          </svg>svg>
        ),
};

export function getNavItems(role: "admin" | "user"): NavItem[] {
    const base: NavItem[] = [
      { href: "/", label: "Dashboard", icon: ICON.dashboard },
      { href: "/posts", label: "Posts", icon: ICON.posts },
      { href: "/properties", label: "Properties", icon: ICON.properties },
      { href: "/reports", label: "Reports", icon: ICON.reports },
      { href: "/settings", label: "Settings", icon: ICON.settings, adminOnly: true },
        ];
    return base.filter((i) => !i.adminOnly || role === "admin");
}
</svg>
