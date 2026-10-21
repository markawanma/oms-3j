// @vitest-environment jsdom
// MetalPriceSection (PM-B · UX A.8) — ช่องทอง (ราคาสมาคมขายออก บาทละ) / ทองเหลือง (บาท/กก.) + เงินคงพฤติกรรมเดิม
//  ต้องถูก: preview สด = ฟังก์ชัน pure ตัวเดียวกับ server · ขอบช่วง 4 จุดตาม A.8.1 · ปุ่มบันทึก (ไม่ blur-save) · หลังบันทึกโชว์ "ค่าที่ server คืน" · error ค่าที่กรอกคงอยู่ · ป้าย "ค่าเดิม" + เตือนไม่มีราคาวันนี้
//  ต้องไม่พัง: เงินยังบันทึกตอน blur ด้วย saveMetalPrice เดิม ไม่มีปุ่มบันทึกแยก
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { OemMetalPriceMap } from "@/lib/oem/types";

const saveInput = vi.fn();
const saveDirect = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/actions/oem", () => ({
  saveMetalPriceInput: (...a: unknown[]) => saveInput(...a),
  saveMetalPrice: (...a: unknown[]) => saveDirect(...a),
  getSilverPriceFreshness: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ToastProvider } from "@/components/ui/Toast";
import { MetalPriceSection } from "./MetalPriceSection";

afterEach(cleanup);
beforeEach(() => {
  saveInput.mockReset();
  saveDirect.mockReset();
  refresh.mockReset();
});

const TODAY = "2026-10-20";
const none: OemMetalPriceMap = { silver: null, gold: null, brass: null };

function renderSection(prices: Partial<OemMetalPriceMap> = {}) {
  return render(
    <ToastProvider>
      <MetalPriceSection prices={{ ...none, ...prices }} todayBkk={TODAY} />
    </ToastProvider>
  );
}

const goldBox = () => screen.getByRole("textbox", { name: "ราคาสมาคมฯ ทองคำแท่ง 96.5% ขายออก (บาทละ)" }) as HTMLInputElement;
const brassBox = () => screen.getByRole("textbox", { name: "ราคาทองเหลือง (บาท/กก.)" }) as HTMLInputElement;
const saveGold = () => screen.getByRole("button", { name: "บันทึกราคาทอง" });
const saveBrass = () => screen.getByRole("button", { name: "บันทึกราคาทองเหลือง" });

describe("ป้าย/หน่วยตามมติเจ้าของ 20 ต.ค.", () => {
  it("ช่องทอง = 'ราคาสมาคมฯ ทองคำแท่ง 96.5% ขายออก (บาทละ)' · ทองเหลือง = บาท/กก. · มี MetalTag ทั้งสามโลหะ · วันที่ = วันนี้ย้อนไม่ได้", () => {
    renderSection();
    expect(goldBox()).toBeInTheDocument();
    expect(brassBox()).toBeInTheDocument();
    expect(screen.getByText("บาท/บาททอง")).toBeInTheDocument();
    expect(screen.getAllByText("บาท/กก.").length).toBeGreaterThanOrEqual(1);
    // ป้ายสีโลหะบนการ์ดที่เปลี่ยน (เงินคงหน้าตาเดิม "เงิน 925" ตาม spec: เงินไม่เปลี่ยน)
    for (const t of ["ทอง", "ทองเหลือง"]) expect(screen.getAllByText(t).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/บันทึกเป็นราคาของวันนี้ \(.*\) — ย้อนวันไม่ได้/)).toHaveLength(2);
  });

  it("empty: ยังไม่เคยตั้งราคา → ข้อความ + เตือนว่าใบผลิตที่ใช้ราคาปิดไม่ได้ (ทั้งทองและทองเหลือง)", () => {
    renderSection();
    expect(screen.getByText("ยังไม่เคยตั้งราคาทอง")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่เคยตั้งราคาทองเหลือง")).toBeInTheDocument();
    expect(screen.getAllByText(/ยังไม่มีราคาของวันนี้ — ใบผลิต/)).toHaveLength(2);
  });
});

describe("placeholder ไม่ใช่ราคาที่ดูจริง (กันลอกตัวเลขตัวอย่างไปกรอก)", () => {
  it("ช่องทอง 'กรอกราคาบาทละ' · ช่องทองเหลือง 'กรอกราคาต่อกิโลกรัม' · ไม่มีตัวเลขเลย · error ทองเหลืองช่องว่างก็ไม่มีตัวอย่างราคา", async () => {
    renderSection();
    expect(goldBox()).toHaveAttribute("placeholder", "กรอกราคาบาทละ");
    expect(brassBox()).toHaveAttribute("placeholder", "กรอกราคาต่อกิโลกรัม");
    for (const b of [goldBox(), brassBox()]) expect(b.getAttribute("placeholder")).not.toMatch(/\d/);
    await userEvent.click(saveBrass());
    const err = await screen.findByRole("alert");
    expect(err).toHaveTextContent("กรอกราคาต่อกิโลกรัมเป็นตัวเลข");
    expect(err.textContent).not.toMatch(/\d/);
  });
});

describe("preview สด (ไม่คิดสูตรใหม่ — ฟังก์ชัน pure ตัวเดียวกับ server)", () => {
  it("ทอง 29,420.92 (ขอบล่าง) → 2,000.00 บาท/กรัม (ทอง 100% · ÷ 15.244 ÷ 0.965) · รับ , ที่วางมาจากเว็บสมาคม", async () => {
    renderSection();
    await userEvent.type(goldBox(), "29,420.92");
    await waitFor(() => expect(screen.getByText(/ค่าที่ระบบจะบันทึก:/)).toHaveTextContent("2,000.00 บาท/กรัม (ทอง 100% · ÷ 15.244 ÷ 0.965)"));
  });
  it("ทองเหลือง 350 → 0.35 บาท/กรัม (÷ 1,000)", async () => {
    renderSection();
    await userEvent.type(brassBox(), "350");
    await waitFor(() => expect(screen.getByText(/ค่าที่ระบบจะบันทึก:/)).toHaveTextContent("0.35 บาท/กรัม (÷ 1,000)"));
  });
  it("ว่าง/ไม่ถูกต้อง → 'ค่าแปลงจะขึ้นที่นี่' พร้อมช่วงที่รับ (ไม่โชว์ตัวเลขที่ไม่ใช่ค่าที่ DB จะรับ)", async () => {
    renderSection();
    expect(screen.getAllByText(/ค่าแปลงจะขึ้นที่นี่ — ช่วงที่รับ/)).toHaveLength(2);
    await userEvent.type(goldBox(), "abc");
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText(/ค่าที่ระบบจะบันทึก:/)).toBeNull();
  });
  it("preview อยู่ใน role=status aria-live=polite (ไม่อ่านทุกตัวอักษร — อัปเดตหลังหยุดพิมพ์)", () => {
    renderSection();
    const status = screen.getAllByRole("status")[0];
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});

describe("ขอบช่วง (golden ตาม A.8.1) — ปฏิเสธพร้อมข้อความ แสดงค่าที่แปลงแล้ว · ไม่ยิง server", () => {
  async function tryGold(v: string) {
    renderSection();
    await userEvent.type(goldBox(), v);
    await userEvent.click(saveGold());
  }
  it("29,420.00 → ต่ำกว่า 2,000 ที่ระบบรับ + ค่าแปลงแล้ว", async () => {
    await tryGold("29,420.00");
    const err = await screen.findByRole("alert");
    expect(err).toHaveTextContent(/แปลงแล้วได้ 1999\.\d+ บาท\/กรัม \(ทอง 100%\) ต่ำกว่า 2,000 ที่ระบบรับ/);
    expect(err).toHaveTextContent('ไม่ใช่ราคาต่อกรัม');
    expect(saveInput).not.toHaveBeenCalled();
    await waitFor(() => expect(goldBox()).toHaveFocus());
  });
  it("117,684.00 → สูงกว่า 8,000 ที่ระบบรับ", async () => {
    await tryGold("117,684.00");
    expect(await screen.findByRole("alert")).toHaveTextContent(/แปลงแล้วได้ 8000\.0\d+ บาท\/กรัม \(ทอง 100%\) สูงกว่า 8,000 ที่ระบบรับ/);
    expect(saveInput).not.toHaveBeenCalled();
  });
  it("ทองเหลือง 99.99 / 1,000.01 → ปฏิเสธ · 100 / 1,000 ผ่านไปถึง server", async () => {
    for (const bad of ["99.99", "1,000.01"]) {
      renderSection();
      await userEvent.type(brassBox(), bad);
      await userEvent.click(saveBrass());
      expect(await screen.findByRole("alert")).toHaveTextContent("ราคาทองเหลืองต้องอยู่ระหว่าง 100–1,000 บาท/กก. (กรอกเป็นบาทต่อกิโลกรัม ไม่ใช่ต่อกรัม)");
      cleanup();
    }
    expect(saveInput).not.toHaveBeenCalled();
    saveInput.mockResolvedValue({ ok: true, data: { metal: "brass", asOfDate: TODAY, priceThbPerGram: 0.1, inputValue: 100, inputUnit: "thb_per_kg" } });
    renderSection();
    await userEvent.type(brassBox(), "100");
    await userEvent.click(saveBrass());
    await waitFor(() => expect(saveInput).toHaveBeenCalledWith({ metal: "brass", inputValue: "100" }));
  });
  it("ว่าง → 'กรอกราคาบาทละเป็นตัวเลข' (ไม่มีตัวอย่างราคา) · ทศนิยม 3 ตำแหน่ง → 'ทศนิยมไม่เกิน 2 ตำแหน่ง'", async () => {
    renderSection();
    await userEvent.click(saveGold());
    const empty = await screen.findByRole("alert");
    expect(empty).toHaveTextContent("กรอกราคาบาทละเป็นตัวเลข");
    expect(empty.textContent).not.toMatch(/\d/);
    await userEvent.type(goldBox(), "41250.123");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ทศนิยมไม่เกิน 2 ตำแหน่ง"));
    expect(saveInput).not.toHaveBeenCalled();
  });
  it("error ตรวจสดหลังพยายามบันทึกครั้งแรก — แก้ให้ถูกแล้วข้อความหาย", async () => {
    await tryGold("29,420.00");
    await screen.findByRole("alert");
    await userEvent.clear(goldBox());
    await userEvent.type(goldBox(), "41250");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("บันทึก", () => {
  it("กรอก 29,420.92 กดบันทึก → ยิง saveMetalPriceInput ด้วยข้อความที่กรอก · โชว์ 'ค่าที่ server คืน' (ชนะ preview) · toast · refresh · ไม่ใช่ blur-save", async () => {
    saveInput.mockResolvedValue({ ok: true, data: { metal: "gold", asOfDate: TODAY, priceThbPerGram: 2000.0001, inputValue: 29420.92, inputUnit: "assoc965_sell_per_baht" } });
    renderSection();
    await userEvent.type(goldBox(), "29,420.92");
    fireEvent.blur(goldBox());
    expect(saveInput).not.toHaveBeenCalled();
    await userEvent.click(saveGold());
    await waitFor(() => expect(saveInput).toHaveBeenCalledWith({ metal: "gold", inputValue: "29,420.92" }));
    // ค่าที่ server คืน (2000.0001) ไม่ใช่ค่า preview (2,000.00) — ต้องแสดงของ server
    expect(await screen.findByText(/บันทึกแล้ว — ระบบเก็บ 2,000.0001 บาท\/กรัม \(ทอง 100%\) · กรอก 29,420.92 บาท\/บาททอง/)).toBeInTheDocument();
    expect(screen.getByText("บันทึกราคาทองของวันนี้แล้ว — 2,000.0001 บาท/กรัม (ทอง 100%)")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(saveDirect).not.toHaveBeenCalled();
  });

  it("กด Enter ในช่อง = บันทึก (คีย์บอร์ด)", async () => {
    saveInput.mockResolvedValue({ ok: true, data: { metal: "gold", asOfDate: TODAY, priceThbPerGram: 2804.1271, inputValue: 41250, inputUnit: "assoc965_sell_per_baht" } });
    renderSection();
    await userEvent.type(goldBox(), "41250{Enter}");
    await waitFor(() => expect(saveInput).toHaveBeenCalledWith({ metal: "gold", inputValue: "41250" }));
  });

  it("loading: ระหว่างบันทึกปุ่ม disabled + ช่อง disabled", async () => {
    let resolve!: (v: unknown) => void;
    saveInput.mockReturnValue(new Promise((r) => (resolve = r)));
    renderSection();
    await userEvent.type(goldBox(), "41250");
    await userEvent.click(saveGold());
    await waitFor(() => expect(goldBox()).toBeDisabled());
    expect(saveGold()).toBeDisabled();
    resolve({ ok: false, error: "x" });
    await waitFor(() => expect(goldBox()).toBeEnabled());
  });

  it("error จาก server: alert + ค่าที่กรอกยังอยู่ (ไม่ reset เหมือนเงิน) + ไม่ refresh", async () => {
    saveInput.mockResolvedValue({ ok: false, error: "บันทึกราคาโลหะไม่สำเร็จ ลองใหม่อีกครั้ง (ค่าที่กรอกยังอยู่)" });
    renderSection();
    await userEvent.type(goldBox(), "41250");
    await userEvent.click(saveGold());
    expect(await screen.findByRole("alert")).toHaveTextContent("ค่าที่กรอกยังอยู่");
    expect(goldBox().value).toBe("41250");
    expect(refresh).not.toHaveBeenCalled();
    expect(saveGold()).toBeEnabled();
  });
});

describe("แถวเดิม + สถานะวันนี้", () => {
  it("แถวเดิมก่อนใช้ช่องราคาสมาคม (ไม่มี input_value): ติดป้าย 'ค่าเดิม ก่อนใช้ช่องราคาสมาคม' แสดงตามที่เก็บ ไม่แปลงกลับ · เตือนไม่มีราคาวันนี้ (25 ส.ค.)", () => {
    renderSection({ gold: { priceThbPerGram: 4736, asOfDate: "2026-08-25", source: "manual" } });
    expect(screen.getByText(/ค่าเดิม ก่อนใช้ช่องราคาสมาคม/)).toBeInTheDocument();
    expect(screen.getByText(/เก็บไว้ 4,736.00 บาท\/กรัม \(ทอง 100%\) — ไม่แปลงกลับเป็นราคาสมาคม/)).toBeInTheDocument();
    expect(screen.getByText(/⚠️ ยังไม่มีราคาของวันนี้ — ใบผลิตทองที่ใช้ราคาทองปิดไม่ได้/)).toBeInTheDocument();
    expect(goldBox().value).toBe("");
  });

  it("ทองเหลืองแถวเดิม 1.0000 บาท/กรัม (= 1,000/กก. ขอบบน) อยู่ในช่วง → ไม่ขึ้น 'นอกช่วง' · ไม่ prefill ลงช่อง (กันหน่วยปน)", () => {
    renderSection({ brass: { priceThbPerGram: 1, asOfDate: "2026-08-25", source: "manual" } });
    expect(screen.queryByText("ค่าเดิมอยู่นอกช่วงที่รับ — กรอกใหม่")).toBeNull();
    expect(brassBox().value).toBe("");
  });

  it("แถวเดิมนอกช่วงใหม่ → ป้าย 'ค่าเดิมอยู่นอกช่วงที่รับ — กรอกใหม่'", () => {
    renderSection({ gold: { priceThbPerGram: 36, asOfDate: "2026-08-25", source: "manual" } });
    expect(screen.getByText("ค่าเดิมอยู่นอกช่วงที่รับ — กรอกใหม่")).toBeInTheDocument();
  });

  it("แถวของวันนี้ที่กรอกด้วยช่องใหม่: แสดง 'กรอก 41,250.00 บาท/บาททอง → เก็บ …' · ไม่เตือน", () => {
    renderSection({
      gold: { priceThbPerGram: 2804.1271, asOfDate: TODAY, source: "manual", inputValue: 41250, inputUnit: "assoc965_sell_per_baht" },
      brass: { priceThbPerGram: 0.35, asOfDate: TODAY, source: "manual", inputValue: 350, inputUnit: "thb_per_kg" },
    });
    expect(screen.getByText(/กรอก 41,250.00 บาท\/บาททอง → เก็บ 2,804.1271 บาท\/กรัม/)).toBeInTheDocument();
    expect(screen.getByText(/กรอก 350.00 บาท\/กก. → เก็บ 0.35 บาท\/กรัม/)).toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่มีราคาของวันนี้/)).toBeNull();
  });

  it("แถวทอง input_unit ผิดชนิด (ทองเหลืองกรอก thb_per_kg ในช่องทอง) ถือเป็นค่าเดิม ไม่แสดงเป็นราคาสมาคม", () => {
    renderSection({ gold: { priceThbPerGram: 3000, asOfDate: TODAY, source: "manual", inputValue: 3000, inputUnit: "thb_per_kg" } });
    expect(screen.getByText(/ค่าเดิม ก่อนใช้ช่องราคาสมาคม/)).toBeInTheDocument();
  });
});

describe("เงิน — พฤติกรรมเดิมไม่เปลี่ยน", () => {
  it("เงินยังเป็น input number บาท/กรัม บันทึกตอน blur ด้วย saveMetalPrice · ไม่มีปุ่ม 'บันทึกราคาเงิน'", async () => {
    saveDirect.mockResolvedValue({ ok: true, data: undefined });
    renderSection({ silver: { priceThbPerGram: 38.5, asOfDate: TODAY, source: "manual" } });
    expect(screen.queryByRole("button", { name: /บันทึกราคาเงิน/ })).toBeNull();
    const silver = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(silver.value).toBe("38.5");
    await userEvent.clear(silver);
    await userEvent.type(silver, "39.5");
    fireEvent.blur(silver);
    await waitFor(() => expect(saveDirect).toHaveBeenCalledWith({ metal: "silver", priceThbPerGram: 39.5 }));
    expect(saveInput).not.toHaveBeenCalled();
  });
});
