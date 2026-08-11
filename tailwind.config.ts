import type { Config } from "tailwindcss";

// Design tokens per ux-ui design summary:
//   primary = indigo-600 (does not collide with Shopee orange / TikTok black
//   channel badges) — success=green, warning=amber, danger=red, info=blue,
//   neutral=slate. Spacing stays on Tailwind's default 4px base scale.
//   Radius: sm=6px, md=8px, lg=12px. Touch targets: min-h-11 (44px).
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#4f46e5", // indigo-600
          50: "#eef2ff",
          100: "#e0e7ff",
          600: "#4f46e5",
          700: "#4338ca",
        },
        // TikTok Ops module accent only (design §7) — 3J brand red. NOT a
        // replacement for `primary`: buttons/chips/tabs stay indigo, `brand`
        // is scoped to accent bars/eyebrows/hero KPI values so it never
        // collides with `danger` (also red, reserved for destructive states).
        brand: {
          DEFAULT: "#a2191d",
          ink: "#7d1316",
        },
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
      },
      spacing: {
        11: "2.75rem", // 44px min touch target
      },
      fontFamily: {
        // next/font self-hosts Noto Sans Thai and exposes it only via this
        // CSS variable (see app/layout.tsx's `notoSansThai.variable` on
        // <html>) — referencing the literal family name "Noto Sans Thai"
        // here would NOT pick up the self-hosted font (next/font renames the
        // injected @font-face internally).
        sans: ["var(--font-noto-sans-thai)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
