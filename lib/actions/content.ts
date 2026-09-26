"use server";

// lib/actions/content.ts — ชั้นวัดผล content (docs/3j-jewelry/analytics/
// ux-content-measurement.md §5.1, backed by supabase/migrations/0145/0148/
// 0149 — all APPLIED to prod, every RPC/view/column name below is real).
//
// Pattern copied 1:1 from lib/actions/calendar.ts: getServiceClient()
// (service role — bypasses RLS) + requireOwnerAdmin() as the app-layer write
// gate (the RPCs themselves also call analytics.crm_require_owner_admin,
// which short-circuits for service_role — see 0021's own comment; the app
// gate below is what actually enforces role today) + ActionResult<T> + Thai
// error strings via lib/marketing/content-errors.ts + console.error on every
// catch + revalidatePath after writes.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import type { ActionResult } from "@/lib/types";
import {
  PLATFORMS,
  deriveExternalId,
  type ContentEntryQueueRow,
  type ContentPlatform,
  type ContentPostStatus,
  type ContentPostSummary,
  type ContentTypeRow,
} from "@/lib/marketing/content-types";
import { mapContentMetricRpcError, mapContentPostRpcError } from "@/lib/marketing/content-errors";

const SCHEMA = "analytics";

// Not exported / not imported from calendar.ts or marketing.ts (both
// module-private there too) — same gate, copied rather than shared so this
// file has no cross-module dependency, matching the existing convention.
async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนวัดผล content ได้" };
  }
  return null;
}

// ============================================================================
// Read — analytics.content_type (0145 §1), global reference data
// ============================================================================

export async function getContentTypes(): Promise<ActionResult<ContentTypeRow[]>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("content_type")
      .select("code, label_th, color_hex, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;

    const rows: ContentTypeRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      code: String(r.code),
      labelTh: String(r.label_th),
      colorHex: String(r.color_hex),
      // M5 fix (26 ก.ย. 69): `Number(r.sort_order) || 100` turned a real
      // sort_order of 0 into 100 — `0 || 100` is `100` in JS, `||` doesn't
      // distinguish "falsy number" from "missing". Only null/undefined
      // should fall back to the 100 default.
      sortOrder: r.sort_order == null ? 100 : Number(r.sort_order),
    }));
    return { ok: true, data: rows };
  } catch (err) {
    console.error("getContentTypes failed", err);
    return { ok: false, error: "โหลดประเภทเนื้อหาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Read — analytics.v_content_entry_queue (0149 §2)
// ============================================================================

/** /marketing/content/entry's queue of (ข) — posts whose age today falls in
 * the T+1/T+3/T+7 read window and don't have real numbers yet.
 *
 * 🔴 M3 fix (26 ก.ย. 69, security ตรวจย้อนหลัง): this used to run a SECOND
 * query against content_post to backfill caption_snapshot (the view, 0149,
 * doesn't select that column) — but nothing in this app ever writes a
 * caption. ContentPostLinkForm (content_post's only writer) has no caption
 * input and never sends `caption` to upsertContentPost, so caption_snapshot
 * is null on every row, always — that second query was a guaranteed-empty
 * round trip on every single page load, worst on mobile/night, exactly the
 * situation this design otherwise goes out of its way to protect (see the
 * localStorage-draft file header). ContentMetricCard's `row.captionSnapshot
 * && <p>...` was consequently dead code — always false.
 *
 * Re-add the content_post lookup (join on post_id, select caption_snapshot)
 * the day a real caption-capture path exists; ContentMetricCard already
 * renders it whenever it's non-null, so no UI change needed then. */
export async function getContentEntryQueue(): Promise<ActionResult<ContentEntryQueueRow[]>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_content_entry_queue")
      .select(
        "post_id, shop_id, platform, external_id, post_url, posted_at, posted_date_th, content_type_code, age_days_today, read_round"
      )
      .eq("shop_id", shopId)
      .order("posted_at", { ascending: false });
    if (error) throw error;

    const rows = (data ?? []) as Record<string, unknown>[];

    const mapped: ContentEntryQueueRow[] = rows.map((r) => ({
      postId: String(r.post_id),
      shopId: String(r.shop_id),
      platform: r.platform as ContentPlatform,
      externalId: String(r.external_id),
      postUrl: String(r.post_url),
      postedAt: String(r.posted_at),
      postedDateTh: String(r.posted_date_th),
      contentTypeCode: (r.content_type_code as string | null) ?? null,
      ageDaysToday: Number(r.age_days_today),
      readRound: Number(r.read_round) as 1 | 2 | 3,
      captionSnapshot: null,
    }));

    return { ok: true, data: mapped };
  } catch (err) {
    console.error("getContentEntryQueue failed", err);
    return { ok: false, error: "โหลดคิวอ่านค่าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Read — analytics.content_post by artifact_id (design §2.1(a))
// ============================================================================

/** For /marketing/calendar/[stepId]: which artifacts already have a linked
 * post, keyed by artifact_id. Deliberately a standalone query (not folded
 * into getCalendarTask/v_campaign_board, which is step-grained, not
 * artifact-grained) — keeps this page's two data sources independent, same
 * "คนละ query กัน อย่าให้ query หนึ่งพังแล้วบล็อกอีกอันที่ไม่เกี่ยวข้อง"
 * principle the design doc states for §1.5's error state. */
export async function getContentPostsByArtifactIds(
  artifactIds: string[]
): Promise<ActionResult<Record<string, ContentPostSummary>>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (artifactIds.length === 0) return { ok: true, data: {} };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("content_post")
      .select("id, artifact_id, platform, external_id, post_url, posted_at, content_type_code, status")
      .eq("shop_id", shopId)
      .in("artifact_id", artifactIds);
    if (error) throw error;

    const map: Record<string, ContentPostSummary> = {};
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const artifactId = r.artifact_id as string | null;
      if (!artifactId) continue;
      map[artifactId] = {
        id: String(r.id),
        platform: r.platform as ContentPlatform,
        externalId: String(r.external_id),
        postUrl: String(r.post_url),
        postedAt: String(r.posted_at),
        contentTypeCode: (r.content_type_code as string | null) ?? null,
        status: r.status as ContentPostStatus,
      };
    }
    return { ok: true, data: map };
  } catch (err) {
    console.error("getContentPostsByArtifactIds failed", err);
    return { ok: false, error: "โหลดลิงก์โพสต์ที่ผูกไว้ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Write — analytics.content_post_upsert (0148 §3)
// ============================================================================

export interface UpsertContentPostInput {
  platform: ContentPlatform;
  /** Full URL as pasted — stored verbatim in post_url. The dedup key
   * (external_id) is derived from this via deriveExternalId(), not typed
   * separately. */
  postUrl: string;
  /** ISO datetime string. */
  postedAt: string;
  contentTypeCode?: string | null;
  artifactId?: string | null;
  caption?: string | null;
}

/** ContentPostLinkForm's submit — used for both design §2.1(a) (in-plan,
 * artifactId set) and §2.1(b) (out-of-plan, artifactId omitted/null; the
 * RPC's p_artifact_id is nullable by design, 0148's own comment: "ถ้าบังคับ
 * ให้สร้างงานในปฏิทินก่อนถึงจะวางลิงก์ได้ ระบบจะถูกเลิกใช้ในสัปดาห์แรก"). */
export async function upsertContentPost(input: UpsertContentPostInput): Promise<ActionResult<string>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const postUrl = input.postUrl?.trim();
  if (!postUrl) return { ok: false, error: "กรุณาวางลิงก์โพสต์ก่อนบันทึก" };
  if (!/^https?:\/\//i.test(postUrl)) {
    return { ok: false, error: "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://" };
  }
  if (!PLATFORMS.includes(input.platform)) {
    return { ok: false, error: "กรุณาเลือกแพลตฟอร์ม" };
  }
  if (!input.postedAt) return { ok: false, error: "กรุณาระบุวันที่โพสต์" };

  const externalId = deriveExternalId(postUrl);

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("content_post_upsert", {
      p_shop_id: shopId,
      p_platform: input.platform,
      p_external_id: externalId,
      p_post_url: postUrl,
      p_posted_at: input.postedAt,
      p_content_type_code: input.contentTypeCode || null,
      p_artifact_id: input.artifactId || null,
      p_caption: input.caption?.trim() || null,
    });
    if (error) throw error;

    revalidatePath("/marketing/content/entry");
    if (input.artifactId) revalidatePath("/marketing/calendar");
    return { ok: true, data: data as string };
  } catch (err) {
    console.error("upsertContentPost failed", err);
    return { ok: false, error: mapContentPostRpcError(err, "บันทึกลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** Edit-after-save is deliberately narrow (design §2.3): only content_type_
 * code can change post-save (null-preserving, safe per 0148) — the URL
 * field is read-only once a post exists (changing it would create a new
 * content_post row under a different external_id, orphaning the old row's
 * metric history). This is the same RPC as create, called with the existing
 * platform/postUrl/postedAt unchanged.
 *
 * 🔴 H2 fix (26 ก.ย. 69, security ตรวจย้อนหลัง): `postId` is accepted but
 * NEVER used below to identify the row — content_post_upsert (0148) has no
 * by-post_id path, it re-derives the row from (shop_id, platform,
 * deriveExternalId(postUrl)) exactly like the create path does. That's
 * harmless today because ContentPostLinkForm is content_post's only
 * writer, so postUrl's derived external_id always matches the row on
 * screen. It stops being harmless the day a second writer exists — 0148's
 * own header names `source='tiktok_api'` (planned P3) as one, where
 * external_id is a video id, NOT a normalized URL. If this ever runs
 * against a row a different writer created under an external_id that
 * doesn't round-trip through deriveExternalId(postUrl), upserting by
 * (shop_id, platform, external_id) would silently INSERT a second row
 * instead of updating the one the owner is looking at — same post, two
 * rows, metric history split across them, and the queue re-lists it as new.
 *
 * `externalId` (the value actually read back from DB when this row was
 * loaded — ContentPostSummary.externalId) is the assert that catches that
 * drift: if re-deriving it from postUrl right now disagrees, this is not
 * the row we think it is, and we refuse instead of upserting blind.
 *
 * Real fix, needed before P3 ships source='tiktok_api': a
 * content_post_update_type(p_post_id, p_content_type_code) RPC that updates
 * by primary key. Until that exists, this assert is the only thing standing
 * between "แก้ประเภท" and a silent duplicate row. */
export async function updateContentPostType(
  postId: string,
  input: { platform: ContentPlatform; postUrl: string; postedAt: string; contentTypeCode: string | null; externalId: string }
): Promise<ActionResult<string>> {
  if (deriveExternalId(input.postUrl) !== input.externalId) {
    console.error("updateContentPostType: externalId mismatch — refusing to upsert blind", {
      postId,
      postUrl: input.postUrl,
      expectedExternalId: input.externalId,
    });
    return {
      ok: false,
      // ไม่ใช่ error ที่ผู้ใช้แก้เองได้ — ถ้า external_id ในฐานข้อมูลไม่
      // round-trip กับ post_url (แถวที่เขียนตรงด้วย service_role หรือแถวจาก
      // source อื่นในอนาคต เช่น tiktok_api ที่ external_id = video id)
      // การรีเฟรชจะวนไม่จบ ต้องมีคนไปแก้ที่ข้อมูล
      error: "ข้อมูลโพสต์นี้ไม่ตรงกับที่บันทึกไว้ในระบบ แก้เองไม่ได้ — แจ้งผู้ดูแลระบบ",
    };
  }

  return upsertContentPost({
    platform: input.platform,
    postUrl: input.postUrl,
    postedAt: input.postedAt,
    contentTypeCode: input.contentTypeCode,
  });
}

// ============================================================================
// Write — analytics.content_post_metric_upsert (0148 §4)
// ============================================================================

export interface UpsertContentMetricInput {
  postId: string;
  view?: number | null;
  like?: number | null;
  comment?: number | null;
  save?: number | null;
  share?: number | null;
}

/** ContentMetricCard's "ยืนยันบันทึก" (design §1.3 confirm step). Client
 * must already have gated "at least 1 field" before calling this (§1.3's
 * disabled-until-≥1-field button) — this action re-checks the same rule
 * server-side since the RPC itself raises on all-null (0148 §H3) and a
 * clearer message here beats a raw 22023 reaching the toast. */
export async function upsertContentMetric(input: UpsertContentMetricInput): Promise<ActionResult<string>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.postId) return { ok: false, error: "ไม่พบโพสต์ที่จะบันทึก" };

  const values = [input.view, input.like, input.comment, input.save, input.share];
  if (values.every((v) => v === null || v === undefined)) {
    return { ok: false, error: "กรอกอย่างน้อย 1 ช่องก่อนบันทึก — ช่องที่ไม่รู้เว้นว่างไว้ได้" };
  }
  for (const v of values) {
    if (v !== null && v !== undefined && v < 0) {
      return { ok: false, error: "ตัวเลขติดลบไม่ได้" };
    }
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("content_post_metric_upsert", {
      p_shop_id: shopId,
      p_post_id: input.postId,
      p_view: input.view ?? null,
      p_like: input.like ?? null,
      p_comment: input.comment ?? null,
      p_save: input.save ?? null,
      p_share: input.share ?? null,
      p_source: "manual",
    });
    if (error) throw error;

    revalidatePath("/marketing/content/entry");
    return { ok: true, data: data as string };
  } catch (err) {
    console.error("upsertContentMetric failed", err);
    return { ok: false, error: mapContentMetricRpcError(err, "บันทึกตัวเลขไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

// ============================================================================
// Write — analytics.content_post_set_status (0148 §5)
// ============================================================================

export async function setContentPostStatus(postId: string, status: ContentPostStatus): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!postId) return { ok: false, error: "ไม่พบโพสต์" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("content_post_set_status", {
      p_shop_id: shopId,
      p_post_id: postId,
      p_status: status,
    });
    if (error) throw error;

    revalidatePath("/marketing/content/entry");
    revalidatePath("/marketing/calendar");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("setContentPostStatus failed", err);
    return { ok: false, error: mapContentMetricRpcError(err, "เปลี่ยนสถานะโพสต์ไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}
