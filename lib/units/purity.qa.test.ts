// QA (independent oracle) — lib/units/purity.ts
// Oracle here is written from the OWNER's rule (37.50-100.00 %, <=2 decimals, digits only — min 37.50 = gold 9K, มติเจ้าของ 18 ต.ค. 69;
// เดิมเขียนเป็น 1.00 ก่อน security M1) using BigInt basis points,
// NOT by mirroring the implementation's regex/branches. Differential fuzz + exhaustive sweeps.
import { describe, expect, it } from "vitest";
import {
  formatPurityPct,
  purityFormIssue,
  purityFractionFromForm,
  purityFractionToPct,
  purityPctIssue,
  purityPctToFraction,
} from "./purity";

function oracle(raw: string): number | null {
  const t = raw.trim();
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return null;
  const [i, f = ""] = t.split(".");
  const bp = BigInt(i || "0") * 100n + BigInt((f + "00").slice(0, 2));
  if (bp < 3750n || bp > 10000n) return null;
  return Number(bp) / 10000;
}

describe("QA purity — differential fuzz vs independent oracle", () => {
  const alphabet = ["0", "1", "2", "5", "7", "9", ".", ".", "-", "+", " ", "e", "%", ",", " ", "๙", "O"];
  it("30k random strings: accepted-set and value identical to oracle", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let accepted = 0;
    for (let n = 0; n < 30000; n++) {
      const len = 1 + Math.floor(rnd() * 8);
      let s = "";
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const want = oracle(s);
      const got = purityPctToFraction(s);
      if (s.trim() === "") {
        expect(got).toBeNull();
        expect(purityPctIssue(s)).toBeNull();
        continue;
      }
      expect({ s, got }).toEqual({ s, got: want });
      expect({ s, issue: purityPctIssue(s) === null }).toEqual({ s, issue: want !== null });
      if (want !== null) accepted++;
    }
    expect(accepted).toBeGreaterThan(100); // fuzz actually hit the accept path
  });

  it("every 0.01% from 37.50 to 100.00: value exact, fraction has <=4 decimals, in (0,1], round-trips to same string", () => {
    for (let bp = 3750; bp <= 10000; bp++) {
      const s = `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}`;
      const f = purityPctToFraction(s);
      expect(f, s).toBe(bp / 10000);
      expect(f! > 0 && f! <= 1, s).toBe(true);
      expect(Number(f!.toFixed(4)), s).toBe(f);
      expect(purityFractionToPct(f), s).toBe(s);
    }
  });

  it("every DB-style 4-decimal fraction k/10000 (k=1..10000): untouched field returns the SAME number, no form issue", () => {
    for (let k = 1; k <= 10000; k++) {
      const orig = k / 10000;
      const shown = purityFractionToPct(orig);
      expect(purityFractionFromForm(shown, orig), String(orig)).toBe(orig);
      expect(purityFormIssue(shown, orig), String(orig)).toBeNull();
    }
  });
});

describe("QA purity — owner's reject list (helper level)", () => {
  it.each(["92.505", "0", "-5", "100.01", "abc", "0.925", "1e2", "92,5", "92.5%", "9 2", "٩٢", "--", ".", "+92", "0.99", "NaN", "Infinity", "92.5.1", "0x5C", "1", "1.0", "1.00", "9.25", "37.49", "37.499", "10"])(
    "%s -> null + has an error message",
    (s) => {
      expect(purityPctToFraction(s)).toBeNull();
      expect(purityPctIssue(s)).toEqual(expect.any(String));
    }
  );
  it("0.925 message tells the user to type a %", () => {
    expect(purityPctIssue("0.925")).toContain("กรอกเป็น %");
    expect(purityPctIssue("0.925")).toContain("92.50");
  });
  it("lower bound 37.50 (gold 9K): '37.5' -> 0.375 · '37.50' -> 0.375 · '37.49' rejected", () => {
    expect(purityPctToFraction("37.5")).toBe(0.375);
    expect(purityPctToFraction("37.50")).toBe(0.375);
    expect(purityPctToFraction("37.49")).toBeNull();
  });
  it("must-not-break: 100 -> 1 · 99.99 -> 0.9999 · 96.5 -> 0.965 · 75 -> 0.75 · 92.50 -> 0.925 · '  92.5 ' trims", () => {
    expect(purityPctToFraction("100")).toBe(1);
    expect(purityPctToFraction("99.99")).toBe(0.9999);
    expect(purityPctToFraction("96.5")).toBe(0.965);
    expect(purityPctToFraction("75")).toBe(0.75);
    expect(purityPctToFraction("92.50")).toBe(0.925);
    expect(purityPctToFraction("  92.5 ")).toBe(0.925);
  });
  it("DB values that exist in prod: 0.9990 -> '99.90' (+ '%' when formatted); 0.925 -> 92.50; 0.9167 -> 91.67", () => {
    expect(purityFractionToPct(0.999)).toBe("99.90");
    expect(formatPurityPct(0.999)).toBe("99.90%");
    expect(purityFractionToPct(0.925)).toBe("92.50");
    expect(purityFractionToPct(0.9167)).toBe("91.67");
  });
  it("hand-check: 10 g x 40 THB/g x 92.50% = 370.00 THB (same as 0.925)", () => {
    const f = purityPctToFraction("92.50")!;
    expect(Math.round(10 * 40 * f * 100) / 100).toBe(370);
    expect(Math.round(10 * 40 * 0.925 * 100) / 100).toBe(370);
  });
});
