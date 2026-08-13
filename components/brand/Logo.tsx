// Logo — 3J Jewelry brand mark. Uses the real artwork the owner supplied at
// public/3j-logo.jpg (enso ring + spark + "3J · JEWELRY" wordmark, all in one
// image). `markOnly` just renders it a touch smaller for tight spaces — the
// image already includes the wordmark, so there's no separate mark/wordmark
// split anymore.
//
// NOTE: the artwork is a JPG (no transparency) on a white ground — it sits
// cleanly on the white header/sidebar. If it's ever placed on a coloured
// surface and the white box shows, ask the owner for a transparent PNG/SVG.

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
      src="/3j-logo.jpg"
      alt="3J Jewelry"
      className={`${markOnly ? "h-9" : "h-10"} w-auto object-contain ${className}`}
    />
  );
}
