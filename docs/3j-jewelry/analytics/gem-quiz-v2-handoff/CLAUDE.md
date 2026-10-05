# 3J Daily Gem Quiz — build brief for Claude Code

You are building the production web app for the **3J JEWELRY Daily Gem Quiz**: a 5-question, mobile-first quiz that recommends a gemstone for today and links to 3J products.

## Source of truth (read these first)

| File | What it is |
|---|---|
| `specs/3J_Daily_Gem_Quiz_V1.md` | Business logic: 5 gems, questions, scoring, tie-breaks, result content, wording rules |
| `specs/3J_Daily_Gem_Quiz_UI_UX_Flow.md` | UI/UX flow, brand colors, interactions, responsive rules |
| `data/quiz-config.json` | All quiz data and scoring weights, already extracted from the V1 spec — load this, do not hard-code |
| `design/Quiz.dc.html` | The approved design: every screen's markup + inline styles, and a working reference scoring engine in the `<script>` block at the bottom (`rank()` and `renderVals()`) |
| `design/Gem.dc.html` | The faceted gem illustration (SVG, 3 colors per gem) |
| `design/S00…S07*.dc.html` | One file per screen state (they import `Quiz.dc.html` with `screen=` set) |

The `.dc.html` files use a small template syntax (`{{hole}}`, `<sc-if>`, `<sc-for>`, `<dc-import>`). Treat them as a **visual + behavioral reference**: port the layout, spacing, colors, fonts, copy and logic into real components. Do not ship the `.dc.html` runtime.

Where the two spec files disagree, **V1 wins** (5 gems only; V1 Q3 options; V1 pairings).

## Recommended stack (change if the owner asks)

- Next.js (App Router) + TypeScript + Tailwind CSS
- No backend needed for V1 — scoring runs client-side from `quiz-config.json`
- Fonts (Google): Cormorant Garamond (Latin display), Noto Serif Thai (Thai headings), IBM Plex Sans Thai (UI/body)
- Deployable to Vercel

## Build order

1. `lib/scoring.ts` — pure function `rankGems(answers, config)` returning gems sorted by total with tie-break order intention → feeling → preference → birth day. Write unit tests that check: the demo answers `{day:"sun", intent:"career", feel:"energy", prefs:["garnet","citrine","amethyst"], type:"ring"}` give Garnet → Citrine → Blue Topaz.
2. Components: `GemIcon`, `QuizHeader` (back, `01 / 05`, progress bar), `OptionCard` (list + grid variants, selected state), `GemPicker` (max 3, ranked, disabled when full), `PrimaryButton`.
3. Screens: Landing → Q1–Q5 → Loading (~1.5 s) → Result (Hero, Why, Pairing, Alternatives, How to wear, Products, CTA, Disclaimer).
4. Result: tapping an alternative gem swaps the hero to that gem; "ทำแบบทดสอบใหม่" resets.
5. Responsive: mobile 375–430 px; on desktop center a 500–600 px card on Warm Ivory `#FAF8F4`.
6. Analytics hook: emit `{birth_day, intention, feeling, gem_preferences, jewelry_type}` and the result object (shape in V1 spec §29).

## Brand rules

- Burgundy `#8F1015`, dark `#650A0D`, ivory `#FAF8F4`, text `#292929`, secondary `#6F6A66`, border `#E5E1DC`. Burgundy only for CTA / progress / selection.
- Radius 14–18 px, thin borders, lots of white space, subtle motion (fade/slide-up, 150–200 ms hovers); respect `prefers-reduced-motion`.
- Touch targets ≥ 44 px; real `<button>`s with `aria-pressed` for options.
- Copy must stay "symbolic / ตามความเชื่อ". Never write รักษา, ป้องกันโรค, รับประกัน, or guaranteed wealth/love.

## Placeholders to replace (ask the owner)

- Logo: the design uses a drawn placeholder — swap in the official 3J logo file (do not alter it).
- Product cards: names are generated (e.g. "แหวนโกเมน"); price shows `฿[ราคา]`. Connect to real product data / TikTok Shop / Shopee links.
- Gem art: SVG illustration for now; real product photography can replace it.
