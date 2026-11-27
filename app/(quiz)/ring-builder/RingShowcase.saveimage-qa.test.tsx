// @vitest-environment jsdom
// QA (R2-D2) 25 พ.ย. 69 — เสริมเทสต์ S1/S6/S18/N1 ให้ครบ "ทุก 8 แบบ × ทุกโหมด" (เทสต์เดิมครอบแค่ bypass2 / direct+null)
//   · ปุ่ม LINE: href/target/rel/ข้อความ เท่ากันเป๊ะระหว่าง "ไม่มี prop ใหม่" (โครงเดิม) กับ "มี onEdit+saveImage"
//   · ภาพที่ compose วาด: ราคาของแบบนั้น = formatPriceThb(id) · ไม่มี URL/@/line.me/โดเมน · ไม่มีตัวเลขภายใน
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { GEM_QUIZ_STONES } from "@/lib/gem-quiz/config";
import { SHOWCASE_COPY, formatPriceThb } from "@/lib/ring-builder/showcase/config";
import { buildShowcaseDetailRows } from "@/lib/ring-builder/showcase/detail-rows";
import { DESIGNS, ownSlotCount } from "@/lib/ring-builder/showcase/designs";
import { buildShowcaseLineHref, type ShowcaseChoice } from "@/lib/ring-builder/showcase/line-message";
import { composeSaveImage, saveImageTexts, type ComposeEnv, type SaveTheme } from "@/lib/ring-builder/save-image/compose";
import { STAGE_H, STAGE_W } from "@/lib/ring-builder/save-image/layout";
import { OrderSummary } from "./_components/OrderSummary";

afterEach(cleanup);

const TOP = GEM_QUIZ_STONES[0].code;
const BOTTOM = GEM_QUIZ_STONES[1].code;

function choicesFor(slotCount: number): ShowcaseChoice[] {
  return [
    { kind: "direct" },
    { kind: "direct", unpicked: true },
    { kind: "own", top: TOP, bottom: BOTTOM },
    { kind: "rec", index: 1, top: TOP, bottom: BOTTOM },
    { kind: "ownSlots", codes: Array.from({ length: slotCount }, () => TOP) },
  ];
}

describe("N1 (ทุกแบบ × ทุกโหมด × ไซซ์ว่าง/ถูก/ผิด): ปุ่ม LINE ไม่ถูกแตะโดยปุ่มใหม่", () => {
  it("href/target/rel/ข้อความ ของ <a> LINE เท่ากับโครงเดิม (ไม่มี onEdit/saveImage) · href = buildShowcaseLineHref", () => {
    let compared = 0;
    for (const d of DESIGNS) {
      const sizes: (number | null)[] = [null, d.sizes[0], d.sizes[d.sizes.length - 1], d.sizes[0] - 1, 0.5];
      for (const choice of choicesFor(ownSlotCount(d))) {
        for (const size of sizes) {
          const link = () => screen.queryByRole("link", { name: new RegExp(SHOWCASE_COPY.lineButton) });
          const a = render(<OrderSummary designId={d.id} choice={choice} size={size} />);
          const before = link();
          const snapBefore = before ? { href: before.getAttribute("href"), target: before.getAttribute("target"), rel: before.getAttribute("rel"), text: before.textContent, disabled: before.getAttribute("aria-disabled") } : null;
          a.unmount();
          const b = render(<OrderSummary designId={d.id} choice={choice} size={size} onEdit={vi.fn()} saveImage={{ ready: true, capture: () => new Uint8Array(4) }} />);
          const after = link();
          const snapAfter = after ? { href: after.getAttribute("href"), target: after.getAttribute("target"), rel: after.getAttribute("rel"), text: after.textContent, disabled: after.getAttribute("aria-disabled") } : null;
          b.unmount();
          expect(snapAfter, `${d.id} ${JSON.stringify(choice)} size=${size}`).toEqual(snapBefore);
          if (snapAfter) expect(snapAfter.href).toBe(buildShowcaseLineHref({ designId: d.id, choice, size }));
          compared++;
        }
      }
    }
    expect(compared).toBe(DESIGNS.length * 5 * 5);
  });

  it("ไซซ์ผิด (href null) → ไม่มีปุ่มบันทึกรูป · ไซซ์ถูก/ว่าง → มี (ด่านเดียวกับปุ่ม LINE)", () => {
    for (const d of DESIGNS) {
      const bad = render(<OrderSummary designId={d.id} choice={{ kind: "direct" }} size={d.sizes[0] - 1} saveImage={{ ready: true, capture: null }} />);
      expect(screen.queryByRole("button", { name: SHOWCASE_COPY.saveButton })).toBeNull();
      bad.unmount();
      for (const size of [null, d.sizes[0]]) {
        const ok = render(<OrderSummary designId={d.id} choice={{ kind: "direct" }} size={size} saveImage={{ ready: true, capture: () => new Uint8Array(4) }} />);
        expect(screen.getByRole("button", { name: SHOWCASE_COPY.saveButton })).toBeEnabled();
        ok.unmount();
      }
    }
  });
});

const THEME: SaveTheme = { ivory: "i", text: "t", textMuted: "m", border: "b", borderSoft: "bs", divider: "d", burgundyDark: "bd", sans: "SansX", display: "DispX, serif" };

function fakeEnv() {
  const texts: string[] = [];
  const ctx = {
    fillRect: vi.fn(), fillText: vi.fn((t: string) => void texts.push(t)), measureText: vi.fn((t: string) => ({ width: t.length * 10 })),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), arc: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })), createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })), putImageData: vi.fn(),
  };
  const env: ComposeEnv = {
    createCanvas: () => ({ width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"], { type: "image/jpeg" })) }) as unknown as HTMLCanvasElement,
    fonts: null,
  };
  return { env, texts };
}

describe("S1/S6/S18 (ทุกแบบ): ข้อความที่ภาพวาดจริง", () => {
  it("ราคาในภาพ = formatPriceThb(id) ของแบบนั้น · ไม่มี URL/@/line.me/โดเมน/QR · ไซซ์ว่าง = 'รอแอดมินช่วยเช็ก' ไม่ใช่ว่าง/0/undefined", async () => {
    const px = new Uint8Array(STAGE_W * STAGE_H * 4).fill(255);
    for (const d of DESIGNS) {
      for (const size of [null, d.sizes[0]]) {
        const input = { designId: d.id, choice: { kind: "direct" } as ShowcaseChoice, size };
        const rows = buildShowcaseDetailRows(input)!.map((r) => ({ label: r.label, value: r.value }));
        const f = fakeEnv();
        await composeSaveImage({ rgba: px, rows, dateText: "25/11/2569", theme: THEME }, f.env);
        const joined = f.texts.join("\n");
        expect(joined, d.id).toContain(formatPriceThb(d.id));
        expect(f.texts.some((t) => t === formatPriceThb(d.id)), `${d.id}: ราคาต้องเป็นข้อความเต็มบรรทัด`).toBe(true);
        expect(joined).not.toMatch(/https?:|www\.|\.com|\.co\.th|@|line\.me|lin\.ee|qr/i);
        expect(joined).not.toMatch(/undefined|NaN|null/);
        // ทุกบรรทัดที่วาดต้องมาจาก whitelist (แถว + SHOWCASE_COPY) — ตัดเป็นชิ้นตามที่ wrapText อาจตัดบรรทัดยาว
        const allowed = saveImageTexts(rows, "25/11/2569").join("");
        for (const t of f.texts) expect(allowed.includes(t.replace(/\s+/g, "")) || allowed.replace(/\s+/g, "").includes(t.replace(/\s+/g, "")), `นอก whitelist: ${t}`).toBe(true);
        // ราคาเป็นตัวเลขขายเดียวในภาพ: ตัวเลข ≥ 3 หลัก (นอกวันที่/ไซซ์) ต้องเป็นราคาของแบบนั้นเท่านั้น
        const priceDigits = formatPriceThb(d.id).replace(/[^0-9,]/g, "");
        const bigNums = (joined.replace(/25\/11\/2569/g, "").match(/\d[\d,]{2,}/g) ?? []).filter((n) => n !== priceDigits);
        expect(bigNums, `${d.id}: ตัวเลขนอกเหนือราคาขาย`).toEqual([]);
        if (size === null) expect(joined).toContain(SHOWCASE_COPY.sizePending);
      }
    }
  });
});
