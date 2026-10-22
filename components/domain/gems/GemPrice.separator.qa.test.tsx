// @vitest-environment jsdom
// QA R2-D2 re-QA: priceIssue (จอ) ปฏิเสธตัวคั่น/ตัวเลขแปลก — คู่กับ lib/actions/gems.price-separator.qa.test.ts (ด่าน action)
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/gems", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { priceIssue } from "@/components/domain/gems/GemPriceDialog";

const WEIRD = ["1，250", "1،250", "1٫5", "１２５０", "๑๒๕๐", "1 250", "1 250", "1e3", "+5", "1_000", "0x10", "١٢٣"];
describe("priceIssue: ตัวคั่น/ตัวเลขแปลก", () => {
  it.each(WEIRD)("%j ถูกปฏิเสธ", (p) => expect(priceIssue(p), p).not.toBeNull());
  it("ราคาที่ถูกต้องผ่าน: 1000 · 12.50 · 0.0001 · \" 7391.2468 \"", () => {
    for (const p of ["1000", "12.50", "0.0001", " 7391.2468 "]) expect(priceIssue(p), p).toBeNull();
  });
});
