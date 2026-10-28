// @vitest-environment jsdom
// PurityPctInput — error แสดงหลัง blur (code review 18 ต.ค. 69): พิมพ์ "96.5" ทีละตัวต้องไม่วูบแดง/ไม่มี role="alert" ระหว่างพิมพ์
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PurityPctInput } from "./PurityPctInput";

afterEach(cleanup);

function Harness({ initial = "", forceShow }: { initial?: string; forceShow?: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <label>
      ความบริสุทธิ์
      <PurityPctInput value={v} onChange={setV} forceShow={forceShow} />
    </label>
  );
}

const box = () => screen.getByRole("textbox") as HTMLInputElement;

describe("PurityPctInput — จังหวะแสดง error", () => {
  it("พิมพ์ทีละตัว 9 → 96 → 96. → 96.5 ไม่มี alert ระหว่างพิมพ์ (แม้ '9' ต่ำกว่าเนื้อต่ำสุดระหว่างทาง) และจบด้วยค่าถูก", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(box());
    for (const ch of ["9", "6", ".", "5"]) {
      await user.keyboard(ch);
      expect(screen.queryByRole("alert")).toBeNull();
    }
    expect(box().value).toBe("96.5");
    fireEvent.blur(box());
    expect(screen.queryByRole("alert")).toBeNull(); // ค่าถูก = ไม่มี error แม้ blur
  });

  it("aria-invalid บอกสถานะจริงทันที (ไม่อ่านออกเสียงเอง) แต่ข้อความ/สีแดงรอ blur", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.type(box(), "9");
    expect(box()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box().className).not.toContain("ring-red");
  });

  it("blur ด้วยค่าผิด → มี alert + สีแดง + aria-describedby ชี้ข้อความ · แก้เป็นค่าถูกแล้ว alert หาย", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.type(box(), "9");
    await user.tab();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("เนื้อโลหะต่ำกว่า 37.50%");
    expect(box().className).toContain("ring-red");
    expect(box().getAttribute("aria-describedby")).toBe(alert.id);
    await user.clear(box());
    await user.type(box(), "96.5");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box()).not.toHaveAttribute("aria-invalid");
  });

  it("forceShow (ผู้เรียกพยายามบันทึกขณะค่าผิด) → เห็นข้อความทันทีโดยไม่ blur", () => {
    render(<Harness initial="0.925" forceShow />);
    expect(screen.getByRole("alert")).toHaveTextContent("กรอกเป็น % เช่น 92.50");
  });

  it("ค่าว่าง = ไม่ใช่ error แม้ blur", () => {
    render(<Harness />);
    fireEvent.blur(box());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box()).not.toHaveAttribute("aria-invalid");
  });
});
