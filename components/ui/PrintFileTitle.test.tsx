// @vitest-environment jsdom
// PrintFileTitle — document.title = ชื่อไฟล์ PDF · ไม่ render อะไร · คืนค่าเดิมเฉพาะเมื่อ title ยังเป็นของเรา
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { PrintFileTitle } from "./PrintFileTitle";

const ORIGINAL = "3J Insight";
const T1 = "261021_JB-0034_ต่างหู";
const T2 = "261021_JB-0034-ส่วน2_ต่างหู";

beforeEach(() => {
  document.title = ORIGINAL;
});
afterEach(cleanup);

describe("PrintFileTitle — โหมด route (whileMounted)", () => {
  it("ตั้ง title ทันทีที่ mount (ครอบคลุมปุ่มที่เรียก window.print() ตรงๆ และ share จากมือถือ) · ไม่ render DOM", () => {
    const { container } = render(<PrintFileTitle title={T1} />);
    expect(document.title).toBe(T1);
    expect(container.innerHTML).toBe("");
  });
  it("unmount (ออกจากหน้าพิมพ์) = คืน '3J Insight'", () => {
    const { unmount } = render(<PrintFileTitle title={T1} />);
    unmount();
    expect(document.title).toBe(ORIGINAL);
  });
  it("beforeprint ตั้งซ้ำ กรณีมีคนทับ title ระหว่างอยู่หน้านี้", () => {
    render(<PrintFileTitle title={T1} />);
    document.title = "something else";
    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe(T1);
  });
  it("afterprint ไม่ถอด title (พิมพ์ซ้ำ/บันทึกซ้ำได้ชื่อเดิม)", () => {
    render(<PrintFileTitle title={T1} />);
    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(T1);
  });
  it("สลับใบย่อยด้วย ?lot= (title เปลี่ยน) = ชื่อใหม่ · แล้วคืนของเดิมจริง ไม่ใช่ของใบก่อน", () => {
    const { rerender, unmount } = render(<PrintFileTitle title={T1} />);
    rerender(<PrintFileTitle title={T2} />);
    expect(document.title).toBe(T2);
    unmount();
    expect(document.title).toBe(ORIGINAL);
  });
  it("ไม่เขียนทับ title ของหน้าถัดไปที่ Next ตั้งไปก่อน unmount", () => {
    const { unmount } = render(<PrintFileTitle title={T1} />);
    document.title = "หน้าถัดไป";
    unmount();
    expect(document.title).toBe("หน้าถัดไป");
  });
  it("React StrictMode (mount→unmount→mount) ไม่ทำให้ค่าเดิมเพี้ยน", () => {
    const { unmount } = render(
      <StrictMode>
        <PrintFileTitle title={T1} />
      </StrictMode>,
    );
    expect(document.title).toBe(T1);
    unmount();
    expect(document.title).toBe(ORIGINAL);
  });
  it("title ว่าง = ไม่แตะ document.title (คง 3J Insight)", () => {
    const { unmount } = render(<PrintFileTitle title="" />);
    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe(ORIGINAL);
    unmount();
    expect(document.title).toBe(ORIGINAL);
  });
  it("หลัง unmount ไม่เหลือ listener (beforeprint ไม่ตั้ง title อีก)", () => {
    const { unmount } = render(<PrintFileTitle title={T1} />);
    unmount();
    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe(ORIGINAL);
  });
});

describe("PrintFileTitle — โหมด printOnly (โปสเตอร์ QR ใน modal)", () => {
  it("แค่เปิด modal (mount) ยังไม่เปลี่ยน title ของหน้า", () => {
    render(<PrintFileTitle title="261023_QR-ร้าน" printOnly />);
    expect(document.title).toBe(ORIGINAL);
  });
  it("beforeprint ตั้ง · afterprint คืนค่าเดิม", () => {
    render(<PrintFileTitle title="261023_QR-ร้าน" printOnly />);
    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe("261023_QR-ร้าน");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(ORIGINAL);
  });
  it("พิมพ์ซ้ำหลายรอบได้ชื่อเดิมทุกรอบ และคืนทุกรอบ", () => {
    render(<PrintFileTitle title="261023_QR-ร้าน" printOnly />);
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new Event("beforeprint"));
      expect(document.title).toBe("261023_QR-ร้าน");
      window.dispatchEvent(new Event("afterprint"));
      expect(document.title).toBe(ORIGINAL);
    }
  });
  it("ปิด modal (unmount) ระหว่างพิมพ์ = คืนค่าเดิม ไม่ค้าง", () => {
    const { unmount } = render(<PrintFileTitle title="261023_QR-ร้าน" printOnly />);
    window.dispatchEvent(new Event("beforeprint"));
    unmount();
    expect(document.title).toBe(ORIGINAL);
  });
  it("afterprint โดยไม่มี beforeprint ก่อน = ไม่แตะอะไร", () => {
    render(<PrintFileTitle title="261023_QR-ร้าน" printOnly />);
    document.title = "other";
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("other");
  });
});
