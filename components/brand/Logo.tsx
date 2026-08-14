// Logo — 3J Jewelry brand mark. Uses the real artwork the owner supplied at
// public/3j-logo.png (enso ring + spark + "3J · JEWELRY" wordmark, all in one
// image). `markOnly` just renders it a touch smaller for tight spaces — the
// image already includes the wordmark, so there's no separate mark/wordmark
// split anymore.
//
// NOTE: the artwork is a transparent PNG (RGBA), so it sits cleanly on any
// surface — white header/sidebar today, and any coloured background later
// without a white box. (Replaced the earlier white-ground JPG.) A matching
// self-contained SVG lives at public/3j-logo.svg, but it just wraps the same
// raster — the PNG is lighter, so use it for the on-screen mark.

export function Logo({
  markOnly = false,
  className = "",
}: {
  markOnly?: boolean;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/3j-logo.png"
      alt="3J Jewelry"
      className={`${markOnly ? "h-9" : "h-10"} w-auto object-contain ${className}`}
    />
  );
}
