import type { Config } from "tailwindcss";

/**
 * Alliance Social design system.
 * Light theme only. Relentless Gold accent + Obsessed Grey. Barlow typography.
 * No dark-mode classes anywhere.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-barlow)",
          "Barlow",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // Relentless Gold — brand accent for primary actions and highlights
        gold: {
          50:  "#FBF8EF",
          100: "#F5EDD2",
          200: "#EBDBA4",
          300: "#E0C876",
          400: "#D5B65B",
          500: "#C9A84C",   // BRAND — Relentless Gold
          600: "#A88A3C",
          700: "#7E6829",
          800: "#534517",
          900: "#2A220B",
        },
        // Obsessed Grey — brand primary dark
        obsessed: {
          DEFAULT: "#252526",   // BRAND — Obsessed Grey
          50:  "#F5F5F6",
          100: "#E5E5E7",
          200: "#C6C6CB",
          300: "#A0A0A8",
          400: "#5F5F66",
          500: "#3D3D42",
          600: "#2F2F33",
          700: "#252526",
          800: "#1A1A1C",
          900: "#0F0F11",
        },
        // Neutral grays for text hierarchy + surfaces
        neutral: {
          0:   "#FFFFFF",
          25:  "#FCFCFB", // off-white background
          50:  "#F8F8F7",
          100: "#F1F1EF",
          200: "#E5E5E2",
          300: "#D4D4D0",
          400: "#A3A3A0",
          500: "#737370",
          600: "#525250",
          700: "#3F3F3D",
          800: "#27272A",
          900: "#18181B",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(24, 24, 27, 0.04), 0 1px 3px rgba(24, 24, 27, 0.06)",
        "card-hover":
          "0 2px 4px rgba(24, 24, 27, 0.06), 0 4px 12px rgba(24, 24, 27, 0.08)",
        elevated:
          "0 4px 8px rgba(24, 24, 27, 0.06), 0 12px 24px rgba(24, 24, 27, 0.08)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(24px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.25s ease-out",
        "slide-in": "slide-in-right 0.22s ease-out",
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};

export default config;
