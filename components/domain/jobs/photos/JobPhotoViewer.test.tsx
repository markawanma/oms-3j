// @vitest-environment jsdom
// ชั้นแสดงผลล้วนของรูปใบงาน: Viewer (เต็มจอ · ปัด · focus trap · Esc · sm→md · รูปพัง) + Thumb + AddButtons
// ต้องไม่พัง: โหมดช่าง (ไม่ส่ง renderActions) ไม่มีปุ่มจัดการ · รูปเดียวไม่มี ‹ › · ลิงก์ใหม่ที่ขอมาไม่ติดสถานะพังของลิงก์เก่า
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { JobPhotoViewer } from "./JobPhotoViewer";
import { JobPhotoThumb } from "./JobPhotoThumb";
import { PhotoAddButtons } from "./PhotoAddButtons";
import type { PhotoView } from "./types";

afterEach(cleanup);

const U = (n: number, v: "sm" | "md", t = "a") => `https://x.supabase.co/storage/v1/object/sign/job-photos/s/j/p${n}_${v}.jpg?token=${t}`;
const photo = (n: number, o: Partial<PhotoView> = {}): PhotoView => ({ id: `p${n}`, smUrl: U(n, "sm"), mdUrl: U(n, "md"), isPrimary: n === 1, ...o });
const FOUR = [photo(1), photo(2), photo(3), photo(4)];

/** ตัวห่อให้ index เป็น state จริง (เหมือนผู้เรียกจริง) */
function Harness({ photos = FOUR, start = 0, onClose = () => undefined, ...rest }: Partial<React.ComponentProps<typeof JobPhotoViewer>> & { start?: number }) {
  const [i, setI] = useState(start);
  return <JobPhotoViewer photos={photos} index={i} onIndexChange={setI} onClose={onClose} title="JB-0034" {...rest} />;
}
const dlg = () => screen.getByRole("dialog", { name: "รูปงาน JB-0034" });
const mdImg = (c: HTMLElement, n: number) => c.querySelector(`img[src="${U(n, "md")}"]`) as HTMLImageElement | null;

describe("JobPhotoViewer — โครง + a11y", () => {
  it("role=dialog aria-modal · หัว 'JB-0034 · 2/4' · alt ไม่มีชื่อลูกค้า/ชื่อไฟล์ · referrerPolicy no-referrer · ไม่มีลิงก์/ปุ่มดาวน์โหลด", () => {
    render(<Harness start={1} />);
    expect(dlg()).toHaveAttribute("aria-modal", "true");
    expect(within(dlg()).getByText("JB-0034 · 2/4")).toBeInTheDocument();
    const img = within(dlg()).getByAltText("รูปงาน JB-0034 รูปที่ 2 จาก 4");
    expect(img).toHaveAttribute("src", U(2, "sm"));
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(within(dlg()).queryByRole("link")).not.toBeInTheDocument();
    expect(within(dlg()).queryByRole("button", { name: /ดาวน์โหลด|download/i })).not.toBeInTheDocument();
  });

  it("เปิดแล้ว focus ที่ปุ่มปิด · ล็อกการเลื่อนหน้าหลัง · ปิดแล้วคืน focus ที่ปุ่มที่กด + ปลดล็อก", async () => {
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>เปิดรูป</button>
          {open && <Harness onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Page />);
    const opener = screen.getByRole("button", { name: "เปิดรูป" });
    await userEvent.click(opener);
    expect(screen.getByRole("button", { name: "ปิดรูป" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("Esc ปิด (ไม่ต้องมี focus ที่ปุ่ม) · ← → เปลี่ยนรูป · ขอบซ้าย/ขวาไม่เลยขอบ", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const view = dlg();
    fireEvent.keyDown(view, { key: "ArrowLeft" });
    expect(within(view).getByText("JB-0034 · 1/4")).toBeInTheDocument();
    fireEvent.keyDown(view, { key: "ArrowRight" });
    fireEvent.keyDown(view, { key: "ArrowRight" });
    expect(within(view).getByText("JB-0034 · 3/4")).toBeInTheDocument();
    fireEvent.keyDown(view, { key: "ArrowRight" });
    fireEvent.keyDown(view, { key: "ArrowRight" });
    expect(within(view).getByText("JB-0034 · 4/4")).toBeInTheDocument();
    fireEvent.keyDown(view, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focus trap: Tab จากปุ่มสุดท้ายวนไปปุ่มแรก · Shift+Tab จากปุ่มแรกวนไปปุ่มสุดท้าย", () => {
    render(<Harness start={1} />);
    const view = dlg();
    const buttons = within(view).getAllByRole("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("ปุ่ม ‹ › เปลี่ยนรูป · รูปแรกปิด ‹ · รูปสุดท้ายปิด › · รูปเดียวไม่มีปุ่มทั้งคู่", async () => {
    const a = render(<Harness />);
    const prev = within(dlg()).getByRole("button", { name: "รูปก่อนหน้า" });
    const next = within(dlg()).getByRole("button", { name: "รูปถัดไป" });
    expect(prev).toBeDisabled();
    await userEvent.click(next);
    expect(within(dlg()).getByText("JB-0034 · 2/4")).toBeInTheDocument();
    expect(prev).toBeEnabled();
    a.unmount();
    render(<Harness photos={[photo(1)]} />);
    expect(screen.queryByRole("button", { name: "รูปถัดไป" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "รูปก่อนหน้า" })).not.toBeInTheDocument();
  });

  it("ปัดด้วยนิ้ว (scroll) เปลี่ยน index ตามรูปที่ชิดกลาง", () => {
    render(<Harness />);
    const sc = screen.getByTestId("viewer-scroll");
    Object.defineProperty(sc, "clientWidth", { configurable: true, value: 300 });
    sc.scrollLeft = 600;
    fireEvent.scroll(sc);
    expect(within(dlg()).getByText("JB-0034 · 3/4")).toBeInTheDocument();
  });

  it("แท็ก '★ รูปหลัก' เฉพาะรูปหลัก · ปุ่มปิดช่าง 56px (h-14) / ออฟฟิศ 44px (h-11)", () => {
    const a = render(<Harness start={1} closeSize="worker" />);
    expect(within(dlg()).queryByText("รูปหลัก")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิดรูป" }).className).toContain("h-14");
    a.unmount();
    render(<Harness start={0} />);
    expect(within(dlg()).getByText("รูปหลัก")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิดรูป" }).className).toContain("h-11");
  });
});

describe("JobPhotoViewer — โหมดจัดการ vs ดูอย่างเดียว", () => {
  it("renderActions แสดงใต้รูป (ออฟฟิศ) · ไม่ส่ง = ไม่มีแถบล่างเลย (ช่าง)", () => {
    const a = render(<Harness renderActions={({ index }) => <button>จัดการ {index + 1}</button>} />);
    expect(within(dlg()).getByRole("button", { name: "จัดการ 1" })).toBeInTheDocument();
    a.unmount();
    render(<Harness />);
    expect(within(dlg()).queryByRole("button", { name: /จัดการ/ })).not.toBeInTheDocument();
    // ปุ่มทั้งหมดที่เหลือ = ปิด + ‹ › เท่านั้น
    expect(within(dlg()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["ปิดรูป", "รูปก่อนหน้า", "รูปถัดไป"]);
  });
});

describe("JobPhotoViewer — sm → md และรูปพัง", () => {
  it("แสดง sm ก่อน · md ซ้อนทับเฉพาะรูปที่ใช้อยู่ ±1 (รูปที่ 4 ยังไม่โหลด md) · md โหลดเสร็จ = เห็นชัด (opacity-100)", () => {
    const { container } = render(<Harness start={0} />);
    expect(mdImg(container, 1)).not.toBeNull();
    expect(mdImg(container, 2)).not.toBeNull();
    expect(mdImg(container, 3)).toBeNull();
    expect(mdImg(container, 4)).toBeNull();
    expect(mdImg(container, 1)!.className).toContain("opacity-0");
    fireEvent.load(mdImg(container, 1)!);
    expect(mdImg(container, 1)!.className).toContain("opacity-100");
    // รูป sm ยังอยู่ใต้ md (ไม่กระพริบ)
    expect(within(dlg()).getByAltText("รูปงาน JB-0034 รูปที่ 1 จาก 4")).toHaveAttribute("src", U(1, "sm"));
  });

  it("md พลาด = คงรูป sm + แถบสถานะ 'โหลดภาพละเอียดไม่ได้' (ไม่ใช่ไอคอนพัง) · ขอลิงก์ใหม่อัตโนมัติ 1 ครั้ง", () => {
    const onRetryLoad = vi.fn();
    const { container } = render(<Harness start={0} onRetryLoad={onRetryLoad} />);
    fireEvent.error(mdImg(container, 1)!);
    expect(within(dlg()).getByRole("status")).toHaveTextContent("โหลดภาพละเอียดไม่ได้");
    expect(within(dlg()).getByAltText("รูปงาน JB-0034 รูปที่ 1 จาก 4")).toBeInTheDocument();
    expect(within(dlg()).queryByText("โหลดรูปไม่ได้")).not.toBeInTheDocument();
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
    expect(onRetryLoad).toHaveBeenCalledWith("error");
  });

  it("sm และ md พลาดทั้งคู่ = ไอคอน + 'โหลดรูปไม่ได้' + [ลองใหม่] → onRetryLoad('tap')", async () => {
    const onRetryLoad = vi.fn();
    const { container } = render(<Harness photos={[photo(1)]} onRetryLoad={onRetryLoad} />);
    fireEvent.error(within(dlg()).getByAltText("รูปงาน JB-0034 รูปที่ 1 จาก 1"));
    fireEvent.error(mdImg(container, 1)!);
    expect(within(dlg()).getByText("โหลดรูปไม่ได้")).toBeInTheDocument();
    await userEvent.click(within(dlg()).getByRole("button", { name: "ลองใหม่" }));
    expect(onRetryLoad).toHaveBeenCalledWith("tap");
  });

  it("ลิงก์ใหม่ (URL เปลี่ยน) ไม่ติดสถานะพังของลิงก์เก่า — ไม่ค้างรูปแตก", () => {
    const first = [photo(1, { smUrl: U(1, "sm", "old"), mdUrl: U(1, "md", "old") })];
    const { rerender } = render(<JobPhotoViewer photos={first} index={0} onIndexChange={() => undefined} onClose={() => undefined} title="JB-0034" />);
    fireEvent.error(within(dlg()).getByAltText("รูปงาน JB-0034 รูปที่ 1 จาก 1"));
    expect(within(dlg()).queryByAltText("รูปงาน JB-0034 รูปที่ 1 จาก 1")).not.toBeInTheDocument();
    rerender(<JobPhotoViewer photos={[photo(1, { smUrl: U(1, "sm", "new"), mdUrl: U(1, "md", "new") })]} index={0} onIndexChange={() => undefined} onClose={() => undefined} title="JB-0034" />);
    expect(within(dlg()).getByAltText("รูปงาน JB-0034 รูปที่ 1 จาก 1")).toHaveAttribute("src", U(1, "sm", "new"));
  });

  it("ไม่มีรูป = ไม่ render อะไร (ไม่มีทางเปิดเปล่า)", () => {
    render(<Harness photos={[]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("JobPhotoThumb", () => {
  it("รูปปกติ: ปุ่มมี aria-label · รูปหลักมีวงแหวน+แท็กดาว+คำ · จากแคตตาล็อกมีแท็ก · ไม่แสดงชื่อไฟล์", async () => {
    const onClick = vi.fn();
    render(<JobPhotoThumb smUrl={U(1, "sm")} size="tile" label="รูปที่ 1 จาก 4 · รูปหลัก · แตะเพื่อดู" isPrimary fromCatalog onClick={onClick} />);
    const b = screen.getByRole("button", { name: "รูปที่ 1 จาก 4 · รูปหลัก · แตะเพื่อดู" });
    expect(b.className).toContain("ring-zinc-900");
    expect(within(b).getByText("รูปหลัก")).toBeInTheDocument();
    expect(within(b).getByText("จากแคตตาล็อก")).toBeInTheDocument();
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("โหลดอยู่ = พื้น pulse · โหลดเสร็จ = หาย", () => {
    const { container } = render(<JobPhotoThumb smUrl={U(1, "sm")} size="tile" label="x" onClick={() => undefined} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    fireEvent.load(container.querySelector("img")!);
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("รูปพัง = ไอคอน + 'โหลดรูปไม่ได้ · แตะลองใหม่' · ขอลิงก์ใหม่อัตโนมัติครั้งเดียวต่อ URL · แตะ = onRetryLoad('tap') ไม่เปิด viewer", async () => {
    const onClick = vi.fn();
    const onRetryLoad = vi.fn();
    const { container } = render(<JobPhotoThumb smUrl={U(1, "sm")} size="tile" label="x" onClick={onClick} onRetryLoad={onRetryLoad} />);
    fireEvent.error(container.querySelector("img")!);
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
    expect(onRetryLoad).toHaveBeenLastCalledWith("error");
    const b = screen.getByRole("button", { name: "โหลดรูปไม่ได้ แตะเพื่อลองใหม่" });
    expect(b).toHaveTextContent("โหลดรูปไม่ได้ · แตะลองใหม่");
    await userEvent.click(b);
    expect(onRetryLoad).toHaveBeenLastCalledWith("tap");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("smUrl เป็น null (เซ็นลิงก์ไม่สำเร็จ) = สถานะพังเลย · URL ใหม่มาแล้วกลับเป็นรูป", () => {
    const { rerender } = render(<JobPhotoThumb smUrl={null} size="tile" label="x" onClick={() => undefined} onRetryLoad={() => undefined} />);
    expect(screen.getByRole("button", { name: "โหลดรูปไม่ได้ แตะเพื่อลองใหม่" })).toBeInTheDocument();
    rerender(<JobPhotoThumb smUrl={U(1, "sm")} size="tile" label="x" onClick={() => undefined} onRetryLoad={() => undefined} />);
    expect(screen.queryByText(/โหลดรูปไม่ได้/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "x" })).toBeInTheDocument();
  });

  it("ชิป 'n รูป' เฉพาะเมื่อ > 1 รูป (หน้าช่าง) · ขนาด 80 ไม่ใช่ tile ไม่มีแท็กรูปหลัก", () => {
    const a = render(<JobPhotoThumb smUrl={U(1, "sm")} size={80} label="ภาพย่อ" isPrimary countChip={4} onClick={() => undefined} />);
    expect(screen.getByText("4 รูป")).toBeInTheDocument();
    expect(screen.queryByText("รูปหลัก")).not.toBeInTheDocument();
    a.unmount();
    render(<JobPhotoThumb smUrl={U(1, "sm")} size={80} label="ภาพย่อ" countChip={1} onClick={() => undefined} />);
    expect(screen.queryByText(/รูป$/)).not.toBeInTheDocument();
  });
});

describe("PhotoAddButtons", () => {
  it("มีทั้งชุดมือถือ (ถ่ายรูป · เลือกจากเครื่อง) และ PC (เพิ่มรูป) — สลับด้วย CSS pointer:coarse เท่านั้น · input กล้องใช้ capture=environment ครั้งละ 1 รูป · input เลือกไฟล์หลายรูป", () => {
    render(<PhotoAddButtons onFiles={() => undefined} />);
    expect(screen.getByRole("button", { name: "ถ่ายรูป" }).className).toContain("min-h-14");
    expect(screen.getByRole("button", { name: "เลือกจากเครื่อง" }).className).toContain("min-h-14");
    expect(screen.getByRole("button", { name: "เพิ่มรูป" }).className).toContain("[@media(pointer:coarse)]:hidden");
    const cam = screen.getByTestId("photo-input-camera") as HTMLInputElement;
    const pick = screen.getByTestId("photo-input-pick") as HTMLInputElement;
    expect(cam).toHaveAttribute("capture", "environment");
    expect(cam.multiple).toBe(false);
    expect(pick.multiple).toBe(true);
    expect(cam.accept).toBe("image/*");
    expect(pick.accept).toBe("image/*");
  });

  it("เลือกไฟล์ → onFiles(File[]) ทั้งหมด · ล้างค่า input (เลือกไฟล์เดิมซ้ำได้)", async () => {
    const onFiles = vi.fn();
    render(<PhotoAddButtons onFiles={onFiles} />);
    const a = new File(["a"], "a.jpg", { type: "image/jpeg" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
    const pick = screen.getByTestId("photo-input-pick") as HTMLInputElement;
    await userEvent.upload(pick, [a, b]);
    expect(onFiles).toHaveBeenCalledWith([a, b]);
    expect(pick.value).toBe("");
    const cam = screen.getByTestId("photo-input-camera");
    await userEvent.upload(cam, a);
    expect(onFiles).toHaveBeenLastCalledWith([a]);
  });

  it("disabled: ทุกปุ่ม/ทุก input ปิด", () => {
    render(<PhotoAddButtons onFiles={() => undefined} disabled />);
    for (const n of ["ถ่ายรูป", "เลือกจากเครื่อง", "เพิ่มรูป"]) expect(screen.getByRole("button", { name: n })).toBeDisabled();
    expect(screen.getByTestId("photo-input-pick")).toBeDisabled();
    expect(screen.getByTestId("photo-input-camera")).toBeDisabled();
  });
});
