// lib/marketing/content-post-inspect-guards.ts
//
// 🔴 H-1 fix (security รอบ 4, 27 ก.ย. 69): pure decision logic extracted out
// of ContentPostLinkForm.tsx so it's directly unit-testable with vitest —
// this repo has NO component-test setup at all (vitest.config.ts's
// `include` never touches components/**, `environment: "node"`, no jsdom;
// confirmed by `find . -iname "*.test.tsx"` returning zero files repo-wide)
// so any logic that needs a real automated test has to live in lib/ as a
// plain function, not inline inside the component.
//
// The bug this closes: inspectContentLink()'s result used to be applied to
// whatever the URL/date fields showed AT THE TIME THE RESPONSE ARRIVED,
// never re-checked against what the owner might have typed in the
// meantime. Two ways that went wrong, no error either time:
//   1. No race needed at all — paste clip A, blur (auto-fills A's date),
//      edit the text to clip B, click "บันทึก" immediately (the button is
//      right there; nothing forces another blur on the URL field) — B gets
//      saved with A's date.
//   2. Genuine race — inspect(A) is still in flight when the owner already
//      changed the field to B; A's answer lands after and overwrites
//      whatever B's fields show, even though B is what's on screen.
// Same bug CLASS as H1/H2 closed earlier this project (screen and DB
// disagreeing with no error) — quieter this time because a wrong-but-
// specific date looks trustworthy instead of an obviously-default one.

/** True if an inspectContentLink() result that was REQUESTED for
 * `requestedUrl` is still safe to apply now that the URL field's live
 * value is `currentUrl` — i.e. the owner hasn't changed the text since the
 * request was fired. Both sides are trimmed the same way
 * ContentPostLinkForm trims before ever calling inspectContentLink, so a
 * change that's purely leading/trailing whitespace doesn't cause a false
 * mismatch. Returns false (discard the whole result — date AND caption,
 * not just one of them) for any other difference, including the field
 * having been cleared to "" while the request was in flight. */
export function shouldApplyInspectResult(requestedUrl: string, currentUrl: string): boolean {
  return requestedUrl.trim() === currentUrl.trim();
}

/** True if the "วันที่โพสต์" field's current value was auto-filled FOR a
 * URL other than the one about to be submitted — i.e. the owner edited the
 * URL after an auto-fill happened, and either no fresh inspect has
 * resolved for the new URL yet, or one did resolve but
 * shouldApplyInspectResult() above correctly discarded it (in which case
 * the "for" marker is deliberately left pointing at the OLD url — see
 * ContentPostLinkForm's URL onChange handler's own comment for why it must
 * NOT clear this ref, or this exact check could never fire).
 *
 * `autoFilledFor === null` means "the date field is not currently tied to
 * any auto-fill" — either the owner typed/edited it by hand (the date
 * field's own onChange clears this to null), or auto-fill has simply never
 * fired yet — never a mismatch on its own, regardless of `submitUrl`. */
export function autoFilledDateMismatch(autoFilledFor: string | null, submitUrl: string): boolean {
  if (autoFilledFor === null) return false;
  return autoFilledFor.trim() !== submitUrl.trim();
}
