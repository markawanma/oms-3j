# app/fonts

Self-hosted web fonts (woff2) for `next/font/local` — replaces `next/font/google`
so `next build` never fetches fonts.googleapis.com (Vercel build failed 3x on
18 Nov 2026 from that fetch).

- Source: fonts.googleapis.com css2 (modern-browser UA) -> files on fonts.gstatic.com, downloaded 18 Nov 2026.
- Subsets kept: `thai` and `latin` only (same as the old `subsets: ["thai","latin"]`; Cormorant: latin only).
- Each family is loaded by two `next/font/local` calls (thai file + latin file) because
  next/font/local cannot attach a unicode-range per file. The CSS variable is a
  font-family stack (latin first, then thai); each file lacks the other script's glyphs,
  so the browser falls through per character.
- `*-variable.woff2` = one variable file serving all listed weights (Google served the same URL per weight).
- Do not put fonts under `public/` (middleware gate). Do not run/extract anything else here.
- Licence: SIL OFL 1.1 — each family folder has its own `OFL.txt` (copied from github.com/google/fonts `ofl/<family>/OFL.txt`).
