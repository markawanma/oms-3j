// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// พับ/กางหมวดเมนู (เจ้าของสั่ง 20 ต.ค. 69) — spec จาก Tech Lead:
// กางทั้งหมดเป็นค่าเริ่มต้น · จำใน localStorage `nav.collapsed.v1` · storage พัง = ไม่จำแต่ไม่พัง ·
// หมวด active กางเองตอนเข้า + มีจุดบอกเมื่อพับ · sidebar กับ drawer ใช้ state เดียว · staff ไม่เห็น "ใบงาน"

let mockPath = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...r
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    // preventDefault: jsdom ไม่รองรับ navigation จริง (กัน "Not implemented: navigation" รกใน log) — onClick ของ NavList ยังถูกเรียก
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...r}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/auth", () => ({ signOut: vi.fn() }));

import { DashboardShell } from "./DashboardShell";
import { NAV_COLLAPSED_KEY } from "@/lib/nav/collapsed";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockPath = "/dashboard";
  window.localStorage.clear();
});

function renderShell(role: "owner" | "admin" | "staff" | null = "admin") {
  return render(
    <DashboardShell role={role}>
      <p>เนื้อหา</p>
    </DashboardShell>
  );
}

/** sidebar desktop = <nav> แรกใน DOM (drawer เปิดทีหลังเป็นตัวที่สอง) */
function sidebar() {
  return within(screen.getAllByRole("navigation", { name: "เมนูหลัก" })[0]);
}

function stored(): unknown {
  const raw = window.localStorage.getItem(NAV_COLLAPSED_KEY);
  return raw === null ? null : JSON.parse(raw);
}

const GROUPS_ADMIN = ["หน้าร้าน", "TikTok Ops", "CRM", "การตลาด", "ผลิตเอง", "ใบงาน", "ต้นทุน & ตั้งค่า"];

describe("DashboardShell — พับ/กางหมวดเมนู", () => {
  it("ค่าเริ่มต้น (ไม่เคยตั้ง): ทุกหมวดกาง · ลำดับ/ชื่อหมวดไม่เปลี่ยน", () => {
    renderShell("admin");
    const names = sidebar()
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(GROUPS_ADMIN);
    for (const b of sidebar().getAllByRole("button")) expect(b).toHaveAttribute("aria-expanded", "true");
    expect(sidebar().getByRole("link", { name: "ลูกค้า" })).toBeVisible();
  });

  it("คลิกหัวหมวด = พับ (aria-expanded=false · ลิงก์ซ่อนจาก a11y tree) · คลิกอีกที = กางกลับ", async () => {
    const user = userEvent.setup();
    renderShell();
    const crm = sidebar().getByRole("button", { name: "CRM" });

    await user.click(crm);
    expect(crm).toHaveAttribute("aria-expanded", "false");
    expect(sidebar().queryByRole("link", { name: "ลูกค้า" })).toBeNull();
    // หมวดอื่นไม่ถูกแตะ
    expect(sidebar().getByRole("button", { name: "TikTok Ops" })).toHaveAttribute("aria-expanded", "true");
    expect(sidebar().getByRole("link", { name: "จดไลฟ์" })).toBeVisible();

    await user.click(crm);
    expect(crm).toHaveAttribute("aria-expanded", "true");
    expect(sidebar().getByRole("link", { name: "ลูกค้า" })).toBeVisible();
  });

  it("aria-controls ชี้ element จริง และ element นั้นถูก hidden เมื่อพับ (ไม่ unmount)", async () => {
    const user = userEvent.setup();
    renderShell();
    const crm = sidebar().getByRole("button", { name: "CRM" });
    const panelId = crm.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId!);
    expect(panel).not.toBeNull();
    expect(panel).not.toHaveAttribute("hidden");

    await user.click(crm);
    expect(document.getElementById(panelId!)).toBe(panel); // ตัวเดิม ไม่ unmount
    expect(panel).toHaveAttribute("hidden");
    // ลิงก์ยังอยู่ใน DOM ภายใน panel ที่ hidden (state ของลูกไม่หาย)
    expect(panel!.querySelector('a[href="/crm/customers"]')).not.toBeNull();
  });

  it("คีย์บอร์ด: หัวหมวดเป็น <button> โฟกัสได้ · Enter และ Space พับ/กาง", async () => {
    const user = userEvent.setup();
    renderShell();
    const crm = sidebar().getByRole("button", { name: "CRM" });
    expect(crm.tagName).toBe("BUTTON");
    expect(crm).toHaveAttribute("type", "button");

    crm.focus();
    expect(crm).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(crm).toHaveAttribute("aria-expanded", "false");
    await user.keyboard(" ");
    expect(crm).toHaveAttribute("aria-expanded", "true");
  });

  it("จำค่า: พับแล้วเขียน localStorage `nav.collapsed.v1` เป็น array ของ label · กางกลับ = เอาออก", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(sidebar().getByRole("button", { name: "CRM" }));
    await user.click(sidebar().getByRole("button", { name: "ผลิตเอง" }));
    expect(stored()).toEqual(["CRM", "ผลิตเอง"]);

    await user.click(sidebar().getByRole("button", { name: "CRM" }));
    expect(stored()).toEqual(["ผลิตเอง"]);
  });

  it("จำค่า: เปิดใหม่ (mount ใหม่) อ่านค่าที่จำไว้หลัง mount — หมวดที่ไม่ใช่ active ยังพับ", async () => {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(["CRM", "ผลิตเอง"]));
    renderShell(); // อยู่ /dashboard (หมวดหน้าร้าน)
    expect(await sidebar().findByRole("button", { name: "CRM" })).toHaveAttribute("aria-expanded", "false");
    expect(sidebar().getByRole("button", { name: "ผลิตเอง" })).toHaveAttribute("aria-expanded", "false");
    expect(sidebar().getByRole("button", { name: "หน้าร้าน" })).toHaveAttribute("aria-expanded", "true");
    expect(sidebar().queryByRole("link", { name: "ลูกค้า" })).toBeNull();
  });

  it("ไม่เขียนทับค่าที่จำไว้ด้วย Set ว่างก่อนอ่านเสร็จ", () => {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(["CRM"]));
    renderShell();
    expect(stored()).toEqual(["CRM"]);
  });

  it("ค่าใน storage เสีย (JSON พัง / ไม่ใช่ array / ชนิดผิด) → กางทั้งหมด ไม่พัง", () => {
    for (const raw of ["{not json", '{"a":1}', "42", '[1,null,{"x":1},""]']) {
      window.localStorage.setItem(NAV_COLLAPSED_KEY, raw);
      const { unmount } = renderShell();
      for (const b of sidebar().getAllByRole("button")) expect(b).toHaveAttribute("aria-expanded", "true");
      unmount();
    }
  });

  it("localStorage.getItem throw (private mode) → เมนูยังขึ้น กางทั้งหมด", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    renderShell();
    for (const b of sidebar().getAllByRole("button")) expect(b).toHaveAttribute("aria-expanded", "true");
  });

  it("localStorage.setItem throw (quota/private mode) → พับ/กางใน memory ยังใช้ได้ ไม่ throw", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    renderShell();
    const crm = sidebar().getByRole("button", { name: "CRM" });
    await user.click(crm);
    expect(crm).toHaveAttribute("aria-expanded", "false");
    await user.click(crm);
    expect(crm).toHaveAttribute("aria-expanded", "true");
  });

  it("เข้าหน้าในหมวดที่จำไว้ว่าพับ → หมวดนั้นกางเอง · หมวดอื่นที่พับยังพับ", async () => {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(["CRM", "ผลิตเอง"]));
    mockPath = "/crm/customers";
    renderShell();
    expect(await sidebar().findByRole("button", { name: "CRM" })).toHaveAttribute("aria-expanded", "true");
    expect(sidebar().getByRole("link", { name: "ลูกค้า" })).toHaveAttribute("aria-current", "page");
    expect(sidebar().getByRole("button", { name: "ผลิตเอง" })).toHaveAttribute("aria-expanded", "false");
  });

  it("พับหมวดที่ active เอง → จุดบอก 'อยู่ในนี้' (ผู้ใช้พับได้ ไม่ล็อก) · หมวดอื่นที่พับไม่มีจุด · กางแล้วจุดหาย", async () => {
    const user = userEvent.setup();
    mockPath = "/crm/customers";
    renderShell();
    const crm = sidebar().getByRole("button", { name: "CRM" });
    expect(crm).toHaveAttribute("aria-expanded", "true");
    expect(crm.querySelector("span.rounded-full")).toBeNull();

    await user.click(crm);
    await user.click(sidebar().getByRole("button", { name: "ผลิตเอง" }));

    const crmCollapsed = sidebar().getByRole("button", { name: /^CRM/ });
    expect(crmCollapsed).toHaveAttribute("aria-expanded", "false");
    expect(crmCollapsed.querySelector("span.rounded-full")).not.toBeNull();
    expect(crmCollapsed).toHaveAccessibleName(/หน้าที่เปิดอยู่/);

    const prod = sidebar().getByRole("button", { name: "ผลิตเอง" });
    expect(prod.querySelector("span.rounded-full")).toBeNull();

    await user.click(crmCollapsed);
    expect(sidebar().getByRole("button", { name: "CRM" }).querySelector("span.rounded-full")).toBeNull();
  });

  it("เปลี่ยนไปหมวดอื่นตอนใช้งาน → หมวดปลายทางกางเอง · เปลี่ยนหน้าภายในหมวดเดิม = ไม่กางซ้ำ", async () => {
    const user = userEvent.setup();
    mockPath = "/dashboard";
    const { rerender } = renderShell();
    await user.click(sidebar().getByRole("button", { name: "CRM" }));
    expect(sidebar().getByRole("button", { name: "CRM" })).toHaveAttribute("aria-expanded", "false");

    // เข้า CRM → กางเอง
    mockPath = "/crm/customers";
    rerender(
      <DashboardShell role="admin">
        <p>เนื้อหา</p>
      </DashboardShell>
    );
    expect(sidebar().getByRole("button", { name: "CRM" })).toHaveAttribute("aria-expanded", "true");

    // ผู้ใช้พับเอง แล้วเปลี่ยนหน้าใน CRM เดิม (เช่นผ่าน sub-nav) → ต้องยังพับ
    await user.click(sidebar().getByRole("button", { name: "CRM" }));
    mockPath = "/crm/orders";
    rerender(
      <DashboardShell role="admin">
        <p>เนื้อหา</p>
      </DashboardShell>
    );
    expect(sidebar().getByRole("button", { name: /^CRM/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("drawer มือถือใช้ state เดียวกับ sidebar · id ของ panel ไม่ซ้ำกัน", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(sidebar().getByRole("button", { name: "CRM" }));

    await user.click(screen.getByRole("button", { name: "เปิดเมนู" }));
    const drawer = within(screen.getByRole("dialog", { name: "เมนูหลัก" }));
    // drawer เปิดมาเห็นสถานะที่พับไว้ใน sidebar
    expect(drawer.getByRole("button", { name: "CRM" })).toHaveAttribute("aria-expanded", "false");
    expect(drawer.getByRole("button", { name: "TikTok Ops" })).toHaveAttribute("aria-expanded", "true");

    // id ไม่ซ้ำข้าม sidebar/drawer
    const ids = screen
      .getAllByRole("button", { name: "CRM" })
      .map((b) => b.getAttribute("aria-controls"));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    // พับ/กางใน drawer สะท้อนไปที่ sidebar
    await user.click(drawer.getByRole("button", { name: "TikTok Ops" }));
    expect(sidebar().getByRole("button", { name: "TikTok Ops" })).toHaveAttribute("aria-expanded", "false");
    expect(stored()).toEqual(["CRM", "TikTok Ops"]);
  });

  it("drawer: กดลิงก์ในเมนูยังปิด drawer ตามเดิม (onNavigate)", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "เปิดเมนู" }));
    const drawer = within(screen.getByRole("dialog", { name: "เมนูหลัก" }));
    await user.click(drawer.getByRole("link", { name: "ลูกค้า" }));
    expect(screen.queryByRole("dialog", { name: "เมนูหลัก" })).toBeNull();
  });

  it("role=staff ไม่เห็นหมวด 'ใบงาน' (คงเดิม) · admin เห็น · owner เห็น + หมวด 'ทีม'", () => {
    const { unmount } = renderShell("staff");
    expect(sidebar().queryByRole("button", { name: "ใบงาน" })).toBeNull();
    expect(sidebar().queryByRole("link", { name: "ใบงานผลิต" })).toBeNull();
    expect(sidebar().queryByRole("button", { name: "ทีม" })).toBeNull();
    unmount();

    const a = renderShell("admin");
    expect(sidebar().getByRole("button", { name: "ใบงาน" })).toBeInTheDocument();
    expect(sidebar().queryByRole("button", { name: "ทีม" })).toBeNull();
    a.unmount();

    renderShell("owner");
    expect(sidebar().getByRole("button", { name: "ใบงาน" })).toBeInTheDocument();
    expect(sidebar().getByRole("button", { name: "ทีม" })).toBeInTheDocument();
  });

  it("staff: label 'ใบงาน' ที่ค้างอยู่ใน storage (เคยพับตอนเป็น admin) ไม่ทำให้พัง และถูกเก็บไว้ ไม่โดนลบ", () => {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(["ใบงาน", "CRM"]));
    renderShell("staff");
    expect(sidebar().getByRole("button", { name: "CRM" })).toHaveAttribute("aria-expanded", "false");
    expect(stored()).toEqual(["ใบงาน", "CRM"]);
  });

  it("หมวด 'ทีม' (owner) พับได้เหมือนหมวดอื่น", async () => {
    const user = userEvent.setup();
    renderShell("owner");
    await user.click(sidebar().getByRole("button", { name: "ทีม" }));
    expect(sidebar().queryByRole("link", { name: "สมาชิก" })).toBeNull();
    expect(stored()).toEqual(["ทีม"]);
  });
});
