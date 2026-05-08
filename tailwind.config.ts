import type { Config } from "tailwindcss";

/**
 * Alliance Social design system.
 * Light theme only. Refined gold accent. Inter typography.
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
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        // Refined gold — accent for primary actions and highlights
        gold: {
          50:  "#FBF7EE",
          100: "#F5EBCF",
          200: "#EBD7A0",
          300: "#E0C271",
          400: "#D4B164",
          500: "#C9A961", // base accent
          600: "#B69552",
          700: "#937843",
          800: "#6F5A33",
          900: "#4B3D24",
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
      },
      animation: {
        "fade-in-up": "fade-in-up 0.25s ease-out",
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};

export default config;
