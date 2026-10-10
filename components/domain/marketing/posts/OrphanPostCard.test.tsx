// @vitest-environment jsdom
// OrphanPostCard: ตัวเลือกที่ผูกไม่ได้ถูก disable พร้อมเหตุผล · เลือก hook ได้/ข้าม · ล้มแล้วกล่องค้างพร้อมข้อความ · ลิงก์ไม่ปลอดภัยไม่เป็น <a>
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/marketing/posts" }));
const linkOrphanPost = vi.fn();
vi.mock("@/lib/actions/content-posts", () => ({ linkOrphanPost: (...a: unknown[]) => linkOrphanPost(...a) }));

import { OrphanPostList } from "./OrphanPostCard";
import type { OrphanPost } from "@/lib/marketing/post-orphans";
import type { PieceRow } from "@/lib/marketing/piece-types";

const POST = "11111111-1111-4111-8111-111111111111";
const post = (o: Partial<OrphanPost> = {}): OrphanPost => ({ postId: POST, platform: "tiktok", postUrl: "https://example.test/v/1", postedAt: "2026-10-09T10:00:00Z", postedDateTh: "2026-10-09", caption: "แคปชัน", ...o });
const piece = (o: Partial<PieceRow>): PieceRow =>
  ({ stepId: "22222222-2222-4222-8222-222222222222", title: "คลิปดูแลเงิน", pieceStatus: "approved", pieceKind: "short_clip", channel: "tiktok", holdReason: null, posts: [], hooks: [], resolvedStart: "2026-10-10", ...o }) as PieceRow;

const renderList = (posts: OrphanPost[], candidates: PieceRow[]) =>
  render(
    <ToastProvider>
      <OrphanPostList posts={posts} candidates={candidates} />
    </ToastProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  linkOrphanPost.mockResolvedValue({ ok: true, data: undefined });
});

describe("OrphanPostCard", () => {
  it("เปิดโพสต์: แท็บใหม่ noopener · ไม่โชว์ URL ดิบ", () => {
    renderList([post()], []);
    const a = screen.getByRole("link", { name: /เปิดโพสต์ใน TikTok/ });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(document.body.textContent).not.toContain("example.test");
  });

  it("ต้องไม่พัง: ลิงก์ javascript: ไม่กลายเป็น <a>", () => {
    renderList([post({ postUrl: "javascript:alert(1)" })], []);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/เปิดไม่ได้/)).toBeInTheDocument();
  });

  it("ตัวเลือกที่ผูกไม่ได้ disable พร้อมเหตุผล · ผูกได้เลือกแล้วส่ง (ไม่ระบุ hook = null)", async () => {
    renderList(
      [post()],
      [
        piece({ stepId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "ชิ้นผูกได้" }),
        piece({ stepId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "ชิ้น FB", pieceKind: "ig_fb_post", channel: "facebook" }),
        piece({ stepId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "ชิ้นรอเงื่อนไข", holdReason: "รอภาพ" }),
      ]
    );
    await userEvent.click(screen.getByRole("button", { name: "ผูกกับชิ้นงาน" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /ชิ้น FB/ })).toBeDisabled();
    expect(within(dialog).getByText(/ผูกกับโพสต์ TikTok ไม่ได้/)).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /ชิ้นรอเงื่อนไข/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "ผูกโพสต์" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: /ชิ้นผูกได้/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "ผูกโพสต์" }));
    await waitFor(() => expect(linkOrphanPost).toHaveBeenCalledWith(POST, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", null));
    expect(refresh).toHaveBeenCalled();
  });

  it("เลือก hook ของชิ้นนั้นได้ → ส่ง hookId", async () => {
    const HOOK = "99999999-9999-4999-8999-999999999999";
    renderList([post()], [piece({ hooks: [{ id: HOOK, label: "A", text: "ใส่อาบน้ำได้ไหม", hookType: "question", derivedFromHookId: null, sourceSignalId: null }] })]);
    await userEvent.click(screen.getByRole("button", { name: "ผูกกับชิ้นงาน" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: /คลิปดูแลเงิน/ }));
    await userEvent.selectOptions(within(dialog).getByLabelText(/โพสต์นี้ใช้ hook ไหน/), HOOK);
    await userEvent.click(within(dialog).getByRole("button", { name: "ผูกโพสต์" }));
    await waitFor(() => expect(linkOrphanPost).toHaveBeenCalledWith(POST, expect.any(String), HOOK));
  });

  it("DB ปฏิเสธ → กล่องไม่ปิด แสดงข้อความไทย · ไม่มีชิ้นให้ผูก → บอกชัด", async () => {
    linkOrphanPost.mockResolvedValue({ ok: false, error: "เวลาโพสต์ของโพสต์นี้อยู่นอกช่วงที่ยอมรับ" });
    renderList([post()], [piece({})]);
    await userEvent.click(screen.getByRole("button", { name: "ผูกกับชิ้นงาน" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: /คลิปดูแลเงิน/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "ผูกโพสต์" }));
    expect(await within(dialog).findByText("เวลาโพสต์ของโพสต์นี้อยู่นอกช่วงที่ยอมรับ")).toBeInTheDocument();
    cleanup();
    renderList([post()], []);
    await userEvent.click(screen.getByRole("button", { name: "ผูกกับชิ้นงาน" }));
    expect(await screen.findByText(/ยังไม่มีชิ้นงานที่อนุมัติแล้ว/)).toBeInTheDocument();
  });
});
