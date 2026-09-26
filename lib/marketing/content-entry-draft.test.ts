// lib/marketing/content-entry-draft.test.ts
//
// QA regression tests (2026-09-26, post-hoc review — see incident brief).
// vitest.config.ts runs this repo's lib/**/*.test.ts under `environment:
// "node"` (no jsdom/testing-library installed), so `window` is undefined by
// default and useContentEntryDraft (a React hook using useState/useEffect)
// can't be rendered here. cleanupStaleContentDrafts is a plain exported
// function that only touches `window.localStorage`, so it's testable by
// stubbing a minimal fake localStorage on globalThis.window — no DOM needed.
//
// What this file does NOT cover (documented, not silently skipped):
//   - useContentEntryDraft's synchronous-read-on-first-render behavior and
//     its debounced write — verified by manual code trace instead (see QA
//     report), not by an automated test, because rendering the hook needs
//     jsdom + @testing-library/react, neither of which is a repo dependency
//     today. Adding either is a call for the Tech Lead, not something QA
//     should do silently mid-review.

import { afterEach, describe, expect, it } from "vitest";
import { cleanupStaleContentDrafts } from "./content-entry-draft";

const PREFIX = "content-entry-draft";

/** Minimal localStorage shape cleanupStaleContentDrafts actually touches:
 * `.length`, `.key(i)`, `.removeItem(k)`. Backed by a plain Map so key order
 * is insertion order (matches real localStorage well enough for this test). */
class FakeStorage {
  private store = new Map<string, string>();
  private lengthThrows = false;
  private removeThrows = false;

  constructor(entries: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(entries)) this.store.set(k, v);
  }

  get length(): number {
    if (this.lengthThrows) throw new Error("SecurityError: storage access blocked");
    return this.store.size;
  }

  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }

  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }

  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }

  removeItem(k: string): void {
    if (this.removeThrows) throw new Error("SecurityError: storage access blocked");
    this.store.delete(k);
  }

  /** Test helper only — not part of the real localStorage interface. */
  keysSnapshot(): string[] {
    return [...this.store.keys()];
  }

  /** Test helper — simulate a private-mode browser where even reading
   * `.length` throws. */
  makeLengthThrow(): void {
    this.lengthThrows = true;
  }

  makeRemoveThrow(): void {
    this.removeThrows = true;
  }
}

afterEach(() => {
  // @ts-expect-error -- deleting a test-only stub, not a real global
  delete globalThis.window;
});

describe("cleanupStaleContentDrafts — happy path", () => {
  it("removes a stale-day key for this shop and keeps today's key", () => {
    const storage = new FakeStorage({
      [`${PREFIX}:shop-1:post-a:2026-09-20`]: "{}",
      [`${PREFIX}:shop-1:post-b:2026-09-26`]: "{}",
    });
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };

    cleanupStaleContentDrafts("shop-1", "2026-09-26");

    expect(storage.keysSnapshot()).toEqual([`${PREFIX}:shop-1:post-b:2026-09-26`]);
  });
});

describe("cleanupStaleContentDrafts — edge cases", () => {
  it("does nothing and does not throw when window is undefined (SSR)", () => {
    expect(typeof window).toBe("undefined");
    expect(() => cleanupStaleContentDrafts("shop-1", "2026-09-26")).not.toThrow();
  });

  it("no-ops cleanly on an empty store", () => {
    const storage = new FakeStorage({});
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };
    expect(() => cleanupStaleContentDrafts("shop-1", "2026-09-26")).not.toThrow();
    expect(storage.keysSnapshot()).toEqual([]);
  });

  it("leaves keys belonging to a different shop untouched, even if stale-dated", () => {
    const storage = new FakeStorage({
      [`${PREFIX}:shop-1:post-a:2026-09-20`]: "{}",
      [`${PREFIX}:shop-2:post-z:2026-09-01`]: "{}", // different shop, very stale — must survive
    });
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };

    cleanupStaleContentDrafts("shop-1", "2026-09-26");

    expect(storage.keysSnapshot()).toEqual([`${PREFIX}:shop-2:post-z:2026-09-01`]);
  });

  it("leaves unrelated (non-draft) localStorage keys completely untouched", () => {
    const storage = new FakeStorage({
      "some-other-app-key": "unrelated-value",
      [`${PREFIX}:shop-1:post-a:2026-09-20`]: "{}",
    });
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };

    cleanupStaleContentDrafts("shop-1", "2026-09-26");

    expect(storage.keysSnapshot()).toEqual(["some-other-app-key"]);
  });

  it("removes multiple stale keys for the same shop in one pass", () => {
    const storage = new FakeStorage({
      [`${PREFIX}:shop-1:post-a:2026-09-20`]: "{}",
      [`${PREFIX}:shop-1:post-b:2026-09-21`]: "{}",
      [`${PREFIX}:shop-1:post-c:2026-09-22`]: "{}",
      [`${PREFIX}:shop-1:post-d:2026-09-26`]: "{}",
    });
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };

    cleanupStaleContentDrafts("shop-1", "2026-09-26");

    expect(storage.keysSnapshot()).toEqual([`${PREFIX}:shop-1:post-d:2026-09-26`]);
  });

  it("never throws even when reading .length itself throws (private-mode-like restriction) " +
    "— this is the exact 'อ่านไม่ได้ก็ต้องไม่พัง' invariant the design doc calls for", () => {
    const storage = new FakeStorage({ [`${PREFIX}:shop-1:post-a:2026-09-20`]: "{}" });
    storage.makeLengthThrow();
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };

    expect(() => cleanupStaleContentDrafts("shop-1", "2026-09-26")).not.toThrow();
    // Nothing removed either, since the whole pass aborted at the first read.
    expect(storage.keysSnapshot()).toEqual([`${PREFIX}:shop-1:post-a:2026-09-20`]);
  });

  it("never throws when removeItem itself throws mid-cleanup (quota/security error on write side)", () => {
    const storage = new FakeStorage({
      [`${PREFIX}:shop-1:post-a:2026-09-20`]: "{}",
      [`${PREFIX}:shop-1:post-b:2026-09-21`]: "{}",
    });
    storage.makeRemoveThrow();
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };

    expect(() => cleanupStaleContentDrafts("shop-1", "2026-09-26")).not.toThrow();
  });

  it("a shopId containing the same delimiter character (':') the key format itself uses " +
    "does not cause a stale key from a different shop to be misidentified as this shop's", () => {
    // Real shopId is a UUID (no colons) today, but the function takes an
    // arbitrary string — worth pinning the boundary behavior since the key
    // format is colon-delimited and offers no escaping.
    const storage = new FakeStorage({
      [`${PREFIX}:shop-1:post-a:2026-09-20`]: "{}", // real target: shop "shop-1"
      [`${PREFIX}:shop-1:extra:post-b:2026-09-20`]: "{}", // belongs to shop "shop-1:extra", NOT "shop-1"
    });
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };

    cleanupStaleContentDrafts("shop-1", "2026-09-26");

    // Both keys start with "content-entry-draft:shop-1:" as a raw string
    // prefix, so both get swept even though only the first one semantically
    // belongs to shop-1 — documenting actual (prefix-based, not
    // segment-based) matching behavior. Harmless in practice (shop_id is
    // always a UUID), but worth knowing if shop_id's format ever changes.
    expect(storage.keysSnapshot()).toEqual([]);
  });

  it("todayTH in an unexpected format still only protects keys ending in exactly that string, " +
    "everything else is treated as stale", () => {
    const storage = new FakeStorage({
      [`${PREFIX}:shop-1:post-a:2026-9-26`]: "{}", // no zero-padding — won't match "2026-09-26"
      [`${PREFIX}:shop-1:post-b:2026-09-26`]: "{}",
    });
    // @ts-expect-error -- test-only global stub
    globalThis.window = { localStorage: storage };

    cleanupStaleContentDrafts("shop-1", "2026-09-26");

    expect(storage.keysSnapshot()).toEqual([`${PREFIX}:shop-1:post-b:2026-09-26`]);
  });
});
