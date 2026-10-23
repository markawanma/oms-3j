// @vitest-environment jsdom
// QA (R2-D2) — PrintFileTitle: เปลี่ยน title ระหว่าง mounted · ว่าง↔ไม่ว่าง · ไม่เหลือ title ค้างหลังออกจากหน้า
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PrintFileTitle } from "./PrintFileTitle";

const ORIGINAL = "3J Insight";

beforeEach(() => {
  document.title = ORIGINAL;
});
afterEach(cleanup);

describe("PrintFileTitle — QA edge", () => {
  it("title เปลี่ยนจาก '' → ค่าจริง (ข้อมูลมาทีหลัง) = ตั้ง · แล้ว → '' = คืนของเดิม", () => {
    const { rerender } = render(<PrintFileTitle title="" />);
    expect(document.title).toBe(ORIGINAL);
    rerender(<PrintFileTitle title="261021_JB-0001_ก" />);
    expect(document.title).toBe("261021_JB-0001_ก");
    rerender(<PrintFileTitle title="" />);
    expect(document.title).toBe(ORIGINAL);
  });

  it("เปลี่ยนใบหลายครั้งติดกัน แล้ว unmount = กลับ 3J Insight (ไม่ใช่ title ของใบก่อนหน้า)", () => {
    const { rerender, unmount } = render(<PrintFileTitle title="A" />);
    rerender(<PrintFileTitle title="B" />);
    rerender(<PrintFileTitle title="C" />);
    expect(document.title).toBe("C");
    unmount();
    expect(document.title).toBe(ORIGINAL);
  });

  it("mount → unmount → mount (เปิดหน้าพิมพ์ใบเดิมซ้ำ) ได้ title เดิมทุกรอบ และกลับ 3J Insight ทุกครั้ง", () => {
    for (let i = 0; i < 3; i++) {
      const r = render(<PrintFileTitle title="261021_RT-2610-001_ก" />);
      expect(document.title).toBe("261021_RT-2610-001_ก");
      r.unmount();
      expect(document.title).toBe(ORIGINAL);
    }
  });

  it("ไม่ render อะไรลง DOM เลย (markup พิมพ์ไม่เปลี่ยน) ทั้งสองโหมด", () => {
    const a = render(<div id="doc"><PrintFileTitle title="X" /></div>);
    expect(a.container.innerHTML).toBe('<div id="doc"></div>');
    cleanup();
    const b = render(<div id="doc"><PrintFileTitle title="X" printOnly /></div>);
    expect(b.container.innerHTML).toBe('<div id="doc"></div>');
  });

  it("printOnly: beforeprint สองครั้งติด (พิมพ์ซ้อน) แล้ว afterprint ครั้งเดียว = คืนของเดิมจริง ไม่ค้างเป็นชื่อไฟล์", () => {
    render(<PrintFileTitle title="261023_QR-ร้าน" printOnly />);
    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe("261023_QR-ร้าน");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(ORIGINAL);
  });

  it("title ที่มีอักขระไทย/อีโมจิ ถูกเก็บตามตัวอักษรไม่ถูกแก้ระหว่างทาง", () => {
    render(<PrintFileTitle title="261021_OEM-1_นายสมชาย-😀" />);
    expect(document.title).toBe("261021_OEM-1_นายสมชาย-😀");
  });
});
