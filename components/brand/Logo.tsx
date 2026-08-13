// Logo — 3J Jewelry brand mark, hand-vectorised (SVG) from the PNG the owner
// provided (owner has no SVG). Enso brushstroke ring + 4-point spark + "3J
// JEWELRY" wordmark, in the brand maroon via `currentColor` (wrap in
// text-primary-700 to theme it). markOnly=true renders just the ring+spark for
// tight spaces (compact header).
//
// NOTE: this is a faithful *approximation* of the original enso. To use the
// exact artwork instead, drop the real file at `public/3j-logo.png` (or .svg)
// and swap this component's mark for an <img>/inline SVG of it.

export function Logo({
  markOnly = false,
  className = "",
}: {
  markOnly?: boolean;
  className?: string;
}) {
  const mark = (
    <svg viewBox="0 0 120 120" className="h-8 w-8 shrink-0 text-primary-700" aria-hidden="true">
      {/* enso ring: a near-closed circle with a soft gap at lower-left,
          round caps give the brushstroke taper */}
      <circle
        cx="60"
        cy="58"
        r="41"
        fill="none"
        stroke="currentColor"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeDasharray="222 36"
        transform="rotate(128 60 58)"
      />
      {/* 4-point spark at upper-right */}
      <path
        d="M95 20 c1.6 6.5 3.9 8.8 10.4 10.4 c-6.5 1.6 -8.8 3.9 -10.4 10.4 c-1.6 -6.5 -3.9 -8.8 -10.4 -10.4 c6.5 -1.6 8.8 -3.9 10.4 -10.4 Z"
        fill="currentColor"
      />
    </svg>
  );

  if (markOnly) return <span className={`inline-flex ${className}`}>{mark}</span>;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {mark}
      <span className="text-base font-bold tracking-[0.2em] text-primary-700">3J</span>
      <span className="-ml-1 text-base font-semibold tracking-[0.2em] text-zinc-500">JEWELRY</span>
    </span>
  );
}
