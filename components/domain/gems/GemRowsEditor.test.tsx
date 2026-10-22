// @vitest-environment jsdom
// GemRowsEditor + GemPicker — พิมพ์ชนิด/รูปทรงใหม่ · ตัวดักชื่อคล้าย (ใช้ตัวที่มี/เพิ่มใหม่) · ถามขนาด 1/2 ค่า · แถวซ้ำ→รวม · รวมทั้งใบ (จำนวนเต็ม) · 4 state · ไม่มีราคา
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { GemRowsEditor } from "@/components/domain/gems/GemRowsEditor";
import { GemPicker } from "@/components/domain/gems/GemPicker";
import type { GemRowServerErrors } from "@/components/domain/gems/GemRowsEditor";
import { emptyGemRow } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import type { GemOptions } from "@/lib/jobs/gems";

afterEach(cleanup);

const T_GOMEN = "11111111-1111-4111-8111-111111111111";
const T_CZ = "11111111-1111-4111-8111-111111111112";
const S_OVAL = "22222222-2222-4222-8222-222222222221";
const S_ROUND = "22222222-2222-4222-8222-222222222222";
const OPTIONS: GemOptions = {
  types: [
    { id: T_GOMEN, name: "โกเมน" },
    { id: T_CZ, name: "CZ" },
  ],
  shapes: [
    { id: S_OVAL, name: "ไข่", hasLength: true },
    { id: S_ROUND, name: "กลม", hasLength: false },
  ],
  items: [
    { gemItemId: "44444444-4444-4444-8444-444444444441", typeId: T_GOMEN, shapeId: S_OVAL, sizeA: 4, sizeB: 6, sizeLabel: "4×6" },
    { gemItemId: "44444444-4444-4444-8444-444444444442", typeId: T_GOMEN, shapeId: S_OVAL, sizeA: 5, sizeB: 7, sizeLabel: "5×7" },
  ],
};

function Harness({
  initial = [],
  options = OPTIONS,
  optionsState = "ready",
  qtyPlanned = 35,
  showIssues = false,
  serverErrors,
  onForce = vi.fn(),
  onRows,
}: {
  initial?: GemDraftRow[];
  options?: GemOptions | null;
  optionsState?: "loading" | "error" | "ready";
  qtyPlanned?: number | null;
  showIssues?: boolean;
  serverErrors?: GemRowServerErrors;
  onForce?: () => void;
  onRows?: (r: GemDraftRow[]) => void;
}) {
  const [rows, setRows] = useState<GemDraftRow[]>(initial);
  return (
    <GemRowsEditor
      idPrefix="t"
      rows={rows}
      onChange={(r) => {
        setRows(r);
        onRows?.(r);
      }}
      options={options}
      optionsState={optionsState}
      optionsError={optionsState === "error" ? "ขัดข้อง" : null}
      onRetryOptions={vi.fn()}
      qtyPlanned={qtyPlanned}
      qtyNote="สั่ง 30 + เผื่อ 5"
      showIssues={showIssues}
      serverErrors={serverErrors}
      onForceSimilar={onForce}
    />
  );
}

const addBtn = () => screen.getByRole("button", { name: /เพิ่มพลอย/ });

async function pick(user: ReturnType<typeof userEvent.setup>, trigger: RegExp, option: string) {
  await user.click(screen.getByRole("button", { name: trigger }));
  await user.click(await screen.findByRole("option", { name: new RegExp("^" + option) }));
}

describe("GemRowsEditor — สถานะ 4 แบบ", () => {
  it("empty: ข้อความ 'ยังไม่มีพลอยในใบนี้' + ปุ่มเพิ่ม · ไม่มีสรุปรวม", () => {
    render(<Harness />);
    expect(screen.getByTestId("gem-empty")).toHaveTextContent("ยังไม่มีพลอยในใบนี้");
    expect(addBtn()).toBeInTheDocument();
    expect(screen.queryByTestId("gem-grand-total")).not.toBeInTheDocument();
  });

  it("loading: แสดง skeleton (role=status) แต่กรอกได้ทันที", async () => {
    const user = userEvent.setup();
    render(<Harness options={null} optionsState="loading" />);
    expect(screen.getByRole("status", { name: "กำลังโหลดรายการพลอย" })).toBeInTheDocument();
    await user.click(addBtn());
    expect(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ })).toBeEnabled();
  });

  it("error: แถบ amber + ลองอีกครั้ง · ยังพิมพ์ชื่อเองได้", async () => {
    const user = userEvent.setup();
    render(<Harness options={null} optionsState="error" />);
    expect(screen.getByText(/โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองอีกครั้ง" })).toBeInTheDocument();
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อชนิดพลอย/ }), "ทับทิม");
    await user.click(await screen.findByRole("option", { name: /เพิ่ม “ทับทิม” เป็นชนิดพลอยใหม่/ }));
    expect(screen.getByRole("button", { name: /ชนิดพลอยแถว 1: ทับทิม/ })).toBeInTheDocument();
  });

  it("server error ของแถว: กล่องแดง role=alert ระบุแถว", () => {
    const r = emptyGemRow();
    render(<Harness initial={[r]} serverErrors={{ [r.key]: { field: "size_a", message: "ขนาดต้องเป็นตัวเลขมากกว่า 0" } }} />);
    expect(screen.getByTestId("gem-server-error-1")).toHaveTextContent("พลอยแถว 1: ขนาดต้องเป็นตัวเลขมากกว่า 0");
    expect(screen.getByTestId("gem-server-error-1")).toHaveAttribute("role", "alert");
  });
});

describe("GemPicker — ค้นหา/เลือก/พิมพ์ใหม่/ตัวดักชื่อคล้าย", () => {
  it("ไม่มีรายการเลย (ไม่ seed): ชวนพิมพ์ชื่อแรก", async () => {
    const user = userEvent.setup();
    render(<Harness options={{ types: [], shapes: [], items: [] }} />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    expect(screen.getByText(/ยังไม่มีชนิดพลอยในระบบ — พิมพ์ชื่อแรกได้เลย/)).toBeInTheDocument();
  });

  it("ค้นหาไม่สนช่องว่าง/ตัวพิมพ์: 'c z' เจอ CZ", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox"), "c z");
    expect(screen.getByRole("option", { name: "CZ" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "โกเมน" })).not.toBeInTheDocument();
  });

  it("พิมพ์ 'โกเมนต์' → ใกล้เคียง 'โกเมน' ขึ้นบน · กดเพิ่มใหม่ → กล่องดัก ปุ่มหลัก 'ใช้ โกเมน' → เลือกตัวเดิม", async () => {
    const user = userEvent.setup();
    const onForce = vi.fn();
    render(<Harness onForce={onForce} />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox"), "โกเมนต์");
    expect(screen.getByText("ใกล้เคียงที่พิมพ์")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /เพิ่ม “โกเมนต์” เป็นชนิดพลอยใหม่/ }));
    const dlg = await screen.findByTestId("gem-similar-prompt");
    expect(dlg).toHaveTextContent("ที่พิมพ์คือ “โกเมนต์”");
    const primary = within(dlg).getByRole("button", { name: /ใช้ “โกเมน”/ });
    await waitFor(() => expect(primary).toHaveFocus());
    await user.click(primary);
    expect(screen.getByRole("button", { name: /ชนิดพลอยแถว 1: โกเมน$/ })).toBeInTheDocument();
    expect(onForce).not.toHaveBeenCalled();
    expect(screen.getByTestId("gem-notice")).toHaveTextContent("ใช้ “โกเมน” ที่มีอยู่แล้วแทน “โกเมนต์”");
  });

  it("'ไม่ใช่ — เพิ่มใหม่' = ชื่อใหม่ + ป้าย ใหม่ + แจ้ง force (ตัวดัก ไม่ใช่ตัวบล็อก)", async () => {
    const user = userEvent.setup();
    const onForce = vi.fn();
    render(<Harness onForce={onForce} />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox"), "โกเมนต์");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “โกเมนต์” เป็นชนิดพลอยใหม่/ }));
    await user.click(await screen.findByRole("button", { name: /ไม่ใช่ — เพิ่ม “โกเมนต์” ใหม่/ }));
    expect(onForce).toHaveBeenCalledTimes(1);
    const trigger = screen.getByRole("button", { name: /ชนิดพลอยแถว 1: โกเมนต์/ });
    expect(within(trigger).getByText("ใหม่")).toBeInTheDocument();
  });

  it("ชื่อซ้ำเป๊ะหลัง normalize (cz) = ใช้ตัวเดิมให้เงียบๆ (ไม่ถาม) + แจ้ง", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox"), "C Z ");
    // exact norm → ไม่มี option เพิ่มใหม่ (มีของเดิมอยู่) → ใช้ Enter บน CZ
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("gem-similar-prompt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ชนิดพลอยแถว 1: CZ$/ })).toBeInTheDocument();
  });

  it("ไม่ควรเตือนมั่ว: ทับทิม↔ไพลิน และ CZ↔AZ (ชื่อสั้น) ไม่ถามตัวดัก", async () => {
    const user = userEvent.setup();
    render(<Harness options={{ ...OPTIONS, types: [...OPTIONS.types, { id: "11111111-1111-4111-8111-111111111113", name: "ไพลิน" }] }} />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox"), "ทับทิม");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “ทับทิม” เป็นชนิดพลอยใหม่/ }));
    expect(screen.queryByTestId("gem-similar-prompt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ชนิดพลอยแถว 1: ทับทิม/ })).toBeInTheDocument();
    await user.click(addBtn()); // แถวแรกยังไม่ครบ → ไม่เพิ่ม
    expect(screen.queryByTestId("gem-row-2")).not.toBeInTheDocument();
  });

  it("ชื่อไม่ผ่านกฎ (เลขล้วน): ข้อความ error ในแผ่น ไม่ปิดแผ่น", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox"), "12");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “12” เป็นชนิดพลอยใหม่/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/ชื่อต้องมี 2-40 ตัวอักษร/);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("Esc ปิดแผ่นและคืนโฟกัสที่ปุ่ม · ลูกศร+Enter เลือกได้", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    const btn = screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ });
    await user.click(btn);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
    await user.click(btn);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("button", { name: /ชนิดพลอยแถว 1: / })).toBeInTheDocument();
  });

  it("รูปทรงใหม่: ถามกี่ค่า · ตกลง aria-disabled จนเลือก · เลือก 2 ค่า → ช่องขนาดกว้าง×ยาว", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /รูปทรงแถว 1/ }));
    await user.type(screen.getByRole("combobox"), "ทรงใบไม้");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “ทรงใบไม้” เป็นรูปทรงใหม่/ }));
    const ask = await screen.findByTestId("gem-new-shape-ask");
    const ok = within(ask).getByRole("button", { name: "ตกลง" });
    expect(ok).toHaveAttribute("aria-disabled", "true");
    await user.click(ok);
    expect(screen.getByTestId("gem-new-shape-ask")).toBeInTheDocument(); // ยังไม่เลือก → ไม่ผ่าน
    await user.click(within(ask).getByRole("radio", { name: /2 ค่า/ }));
    await user.click(within(ask).getByRole("button", { name: "ตกลง" }));
    expect(screen.getByLabelText("ขนาดด้านกว้าง (มม.)")).toBeInTheDocument();
    expect(screen.getByLabelText("ขนาดด้านยาว (มม.)")).toBeInTheDocument();
  });

  it("ชื่อใหม่ในฟอร์มขึ้นรายการของแถวถัดไปพร้อมป้าย 'ใหม่'", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    void rerender;
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox"), "ทับทิม");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “ทับทิม” เป็นชนิดพลอยใหม่/ }));
    await pick(user, /รูปทรงแถว 1/, "กลม");
    await user.type(screen.getByLabelText("ขนาด (มม.)"), "2");
    await user.type(screen.getByLabelText("จำนวนต่อชิ้น *"), "3");
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: /ชนิดพลอยแถว 2/ }));
    const opt = screen.getByRole("option", { name: /ทับทิม/ });
    expect(opt).toHaveTextContent("ใหม่");
  });
});

describe("แถว: ขนาด · จำนวน · รวมทั้งใบ · แถวซ้ำ", () => {
  async function fillOval(user: ReturnType<typeof userEvent.setup>, a: string, b: string, qty: string) {
    await pick(user, /ชนิดพลอยแถว 1/, "โกเมน");
    await pick(user, /รูปทรงแถว 1/, "ไข่");
    await user.type(screen.getByLabelText("ขนาดด้านกว้าง (มม.)"), a);
    await user.type(screen.getByLabelText("ขนาดด้านยาว (มม.)"), b);
    await user.type(screen.getByLabelText("จำนวนต่อชิ้น *"), qty);
  }

  it("ตัวอย่างชื่อ + รวมทั้งแถว (2 × 35 = 70) + รวมทั้งใบ + บอกตัวคูณ", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await fillOval(user, "4", "6", "2");
    expect(screen.getByTestId("gem-preview-1")).toHaveTextContent("โกเมน · ไข่ · 4×6 มม.");
    expect(screen.getByTestId("gem-line-total-1")).toHaveTextContent("รวม 70 เม็ด");
    expect(screen.getByTestId("gem-grand-total")).toHaveTextContent("รวม 1 รายการ · 70 เม็ด");
    expect(screen.getByTestId("gem-multiplier")).toHaveTextContent("จำนวนที่จะผลิต 35 ชิ้น (สั่ง 30 + เผื่อ 5)");
  });

  it("กรอกกลับด้าน 6×4 → บอก 'เรียงเป็น 4×6 ให้'", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await fillOval(user, "6", "4", "1");
    expect(screen.getByTestId("gem-swapped")).toHaveTextContent("เรียงเป็น 4×6 ให้");
  });

  it("ขนาด > 30 มม.: กล่อง amber + ต้องติ๊กยืนยัน (error ถ้ายังไม่ติ๊กเมื่อ showIssues)", async () => {
    const user = userEvent.setup();
    let latest: GemDraftRow[] = [];
    render(<Harness showIssues onRows={(r) => (latest = r)} />);
    await user.click(addBtn());
    await fillOval(user, "31", "35", "1");
    const box = screen.getByTestId("gem-big-size");
    expect(box).toHaveTextContent("ใหญ่ผิดปกติสำหรับพลอยเครื่องประดับ");
    await user.click(within(box).getByRole("checkbox", { name: "ใช่ ขนาดนี้ถูกต้อง" }));
    expect(latest[0].bigConfirmed).toBe(true);
  });

  it("ชิป 'เคยใช้' เฉพาะชนิด+รูปทรงที่เคยมี · แตะ = เติมช่อง", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await pick(user, /ชนิดพลอยแถว 1/, "โกเมน");
    await pick(user, /รูปทรงแถว 1/, "ไข่");
    const chips = screen.getByLabelText("ขนาดที่เคยใช้");
    await user.click(within(chips).getByRole("button", { name: "5×7" }));
    expect((screen.getByLabelText("ขนาดด้านกว้าง (มม.)") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("ขนาดด้านยาว (มม.)") as HTMLInputElement).value).toBe("7");
  });

  it("เปลี่ยนรูปทรงเป็น 1 ค่า: ล้างด้านที่สอง + แจ้ง", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await fillOval(user, "4", "6", "1");
    await pick(user, /รูปทรงแถว 1/, "กลม");
    expect(screen.queryByLabelText("ขนาดด้านยาว (มม.)")).not.toBeInTheDocument();
    expect(screen.getByTestId("gem-notice")).toHaveTextContent("ล้างด้านที่สองออกแล้ว");
  });

  it("แถวซ้ำ: กล่อง amber 'มีพลอยแบบเดียวกันอยู่แล้วที่แถว 1' · รวมเข้าแถว 1 = บวกจำนวน (ไม่รวมเงียบๆ)", async () => {
    const user = userEvent.setup();
    const a: GemDraftRow = { ...emptyGemRow(), type: { kind: "existing", id: T_GOMEN, name: "โกเมน" }, shape: { kind: "existing", id: S_OVAL, name: "ไข่", hasLength: true }, sizeA: "4", sizeB: "6", qty: "2" };
    const b: GemDraftRow = { ...a, key: "dup2", sizeA: "6", sizeB: "4", qty: "3", position: "บ่า" };
    render(<Harness initial={[a, b]} />);
    const dup = screen.getByTestId("gem-dup-2");
    expect(dup).toHaveTextContent("มีพลอยแบบเดียวกันอยู่แล้วที่แถว 1");
    expect(screen.getByTestId("gem-row-2")).toBeInTheDocument();
    await user.click(within(dup).getByRole("button", { name: "รวมเข้าแถว 1" }));
    expect(screen.queryByTestId("gem-row-2")).not.toBeInTheDocument();
    expect((screen.getByLabelText("จำนวนต่อชิ้น *") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText(/ตำแหน่ง/) as HTMLInputElement).value).toBe("บ่า");
  });

  it("เพิ่มพลอยไม่ได้ขณะแถวสุดท้ายไม่ครบ (aria-disabled + เหตุผลถูกข้อ)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    expect(addBtn()).toHaveAttribute("aria-disabled", "true");
    await user.click(addBtn());
    expect(screen.queryByTestId("gem-row-2")).not.toBeInTheDocument();
    expect(screen.getByText(/กรอกแถว 1 ให้ครบก่อน — เลือกหรือพิมพ์ชนิดพลอย/)).toBeInTheDocument();
  });

  it("ลบแถว: แจ้ง 'ลบแถวแล้ว' และโฟกัสกลับที่ปุ่มเพิ่มพลอย", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(addBtn());
    await user.click(screen.getByRole("button", { name: "ลบพลอยแถว 1" }));
    expect(screen.getByTestId("gem-notice")).toHaveTextContent("ลบแถวแล้ว");
    await waitFor(() => expect(addBtn()).toHaveFocus());
  });

  it("รายการจากแม่แบบ: ป้าย 'จากแม่แบบ' → แก้จำนวนแล้วเป็น 'แก้แล้ว' · เปลี่ยนรายการ = ปลดล็อกเป็นช่องชนิด/รูปทรง/ขนาด", async () => {
    const user = userEvent.setup();
    const tpl: GemDraftRow = { ...emptyGemRow("template"), itemId: "44444444-4444-4444-8444-444444444441", canonicalId: "44444444-4444-4444-8444-444444444441", label: "โกเมน · ไข่ · 4×6 มม.", qty: "2" };
    render(<Harness initial={[tpl]} />);
    expect(screen.getByText("จากแม่แบบ")).toBeInTheDocument();
    expect(screen.getByTestId("gem-row-label-1")).toHaveTextContent("โกเมน · ไข่ · 4×6 มม.");
    await user.type(screen.getByLabelText("จำนวนต่อชิ้น *"), "0");
    expect(screen.queryByText("จากแม่แบบ")).not.toBeInTheDocument();
    expect(screen.getByText("แก้แล้ว")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เปลี่ยนรายการ" }));
    expect(screen.getByRole("button", { name: /ชนิดพลอยแถว 1: โกเมน/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /รูปทรงแถว 1: ไข่/ })).toBeInTheDocument();
    expect((screen.getByLabelText("ขนาดด้านกว้าง (มม.)") as HTMLInputElement).value).toBe("4");
  });
});

describe("🔴 ฟอร์มพลอยไม่มีราคา/ต้นทุน/เผื่อแตก", () => {
  it("DOM ของตัวแก้ ไม่มีคำเรื่องราคา", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(addBtn());
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/ราคา|ต้นทุน|บาท|฿|เผื่อแตก|price|cost/i);
    expect(container.innerHTML).not.toMatch(/price|cost|thb/i);
  });
});

describe("ข้อความผิดโผล่เมื่อออกจากแถวเท่านั้น (ไม่ดุตั้งแต่เปิดตัวเลือกแรก)", () => {
  it("เปิดตัวเลือกชนิด/เลือกชนิด: ยังไม่ขึ้น error ของช่องอื่น · ออกจากแถว (tab ไปปุ่มลบ/นอกแถว) แล้วจึงขึ้น", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness />
        <button type="button">นอกแถว</button>
      </div>,
    );
    await user.click(addBtn());
    await pick(user, /ชนิดพลอยแถว 1/, "โกเมน");
    expect(document.querySelector('[id$="-shape-err"]')).toBeNull();
    expect(document.querySelector('[id$="-qty-err"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "นอกแถว" }));
    await waitFor(() => expect(document.querySelector('[id$="-shape-err"]')).not.toBeNull());
    expect(document.querySelector('[id$="-qty-err"]')).toHaveTextContent("จำนวนต่อชิ้นต้องเป็นเลข 1–1,000");
  });
});

describe("GemPicker presentation=sheet (สำหรับหน้างานมือถือ W3)", () => {
  it("เปิดเป็นแผ่นเต็มจอ (fixed inset-0) · ปุ่มกลับ · ช่องค้นหา/แถวตัวเลือก ≥ 56px · เลือกแล้วปิด + โฟกัสกลับปุ่ม", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<GemPicker kind="type" id="sheet" label="ชนิดพลอย" options={[{ id: T_GOMEN, name: "โกเมน" }]} pending={[]} presentation="sheet" value={null} onSelect={onSelect} />);
    const btn = screen.getByRole("button", { name: "ชนิดพลอย" });
    expect(btn.className).toContain("min-h-14");
    await user.click(btn);
    const panel = screen.getByTestId("sheet-panel");
    expect(panel.className).toContain("fixed inset-0");
    expect(within(panel).getByRole("button", { name: "กลับ" })).toBeInTheDocument();
    expect(within(panel).getByRole("combobox").className).toContain("min-h-14");
    const opt = within(panel).getByRole("option", { name: "โกเมน" });
    expect(opt.className).toContain("min-h-14");
    await user.click(opt);
    expect(onSelect).toHaveBeenCalledWith({ kind: "existing", id: T_GOMEN, name: "โกเมน" });
    expect(screen.queryByTestId("sheet-panel")).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });
});
