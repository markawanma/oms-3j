import type { Config } from "tailwindcss";

// Design tokens per ux-ui theme spec (docs/3j-jewelry/ops-app/3j-theme-spec.md):
//   primary = 3J brand red scale derived from #a2191d (hue ~358°) — used for
//   primary buttons, nav active state, focus ring, links. NOT the same scale
//   as `danger` (stock Tailwind red-*): brand is locked to 600-900 / 50-100
//   only, 400/500 are decorative-only (chart bars) and must never be used as
//   a solid button/badge fill (visually too close to danger red-600).
//   success=green, warning=amber, danger=red, info=blue, neutral=zinc.
//   Spacing stays on Tailwind's default 4px base scale.
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
          DEFAULT: "#a2191d", // = 600, locked to brand DNA exactly
          50: "#faf5f5",
          100: "#f4e6e6",
          200: "#ebcbcc",
          300: "#e0a3a5",
          400: "#d67174", // decorative only (chart bars) — never a solid button/badge fill
          500: "#cf3036", // same caution as 400 — visually adjacent to danger red
          600: "#a2191d", // primary buttons, nav active, focus ring, links
          700: "#801418", // hover/active state of 600
          800: "#610f12",
          900: "#470b0d",
        },
        // TikTok Ops module accent only (design §7) — legacy alias, same hex
        // as `primary.600` (#a2191d) now that primary itself is brand red.
        // Kept as-is (not merged into `primary`) to limit this theme pass's
        // diff — see 3j-theme-spec.md §6 optional cleanup for future merge.
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
        // Gem Quiz v2 (app/(quiz)/**) — 3 self-hosted families declared in
        // app/(quiz)/layout.tsx via next/font/google (same .variable pattern
        // as above). Scoped under their own keys instead of overriding
        // `sans` so the rest of the app is unaffected.
        "quiz-display": ["var(--font-gem-quiz-display)", "serif"], // Cormorant Garamond — wordmark/hero numerals
        "quiz-serif": ["var(--font-gem-quiz-serif)", "serif"], // Noto Serif Thai — Thai headings
        "quiz-sans": ["var(--font-gem-quiz-sans)", "system-ui", "sans-serif"], // IBM Plex Sans Thai — body/UI
      },
      keyframes: {
        // Entrance/ambient motion ported from the Quiz.dc.html mockup.
        // Always used behind Tailwind's `motion-safe:` variant so
        // `prefers-reduced-motion: reduce` disables them purely via CSS
        // (design doc §5: "reduced-motion ผ่าน CSS ไม่ใช่ JS").
        "gq-fade-up": { "0%": { opacity: "0", transform: "translateY(10px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "gq-gem-in": { "0%": { opacity: "0", transform: "scale(0.85)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        "gq-twinkle": { "0%, 100%": { opacity: "0.25" }, "50%": { opacity: "1" } },
        "gq-spin-rev": { "0%": { transform: "rotate(360deg)" }, "100%": { transform: "rotate(0deg)" } },
      },
      animation: {
        "gq-fade-up": "gq-fade-up .45s ease-out both",
        "gq-gem-in": "gq-gem-in .5s ease-out both",
        "gq-twinkle": "gq-twinkle 1.8s ease-in-out infinite",
        "gq-spin-slow": "spin 3.2s linear infinite",
        "gq-spin-slow-rev": "gq-spin-rev 4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
