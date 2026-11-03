// lib/auth/deployment.ts — "นี่คือ deployment จริงไหม" + "ชั้น action ต้องบังคับ session ไหม" (pure · ไม่มี runtime import)
// แยกจาก role.ts โดยตั้งใจ (เหตุผลเดียวกับ owner-admin.ts): เทสต์ ~50 ไฟล์ mock "@/lib/auth/role" ด้วย factory ที่มีแค่ getEffectiveRole —
// ถ้า session.ts ต้อง import ฟังก์ชันพวกนี้จาก role.ts ทุก action ที่ผ่าน session.ts จะพังใต้ mock · ไฟล์นี้ไม่มี server-only จึง import ได้ทุกที่
// import จากไฟล์นี้เท่านั้น — อย่า re-export จาก role.ts
//
// มติเจ้าของ 3 พ.ย. 69 (A-แคบ): บน deployment จริง ชั้น action (requireSessionIfGateOn / requireMemberIfGateOn)
// บังคับเสมอ ไม่ฟัง AUTH_GATE · middleware ยังฟัง AUTH_GATE เรื่อง redirect เหมือนเดิม (ไม่ได้ import ไฟล์นี้)
// ผล: ปิด AUTH_GATE บน prod/preview ไม่ได้ทำให้ action เปิดให้คนไม่มี session อีกต่อไป

/** Fail-closed: a production build, or anything Vercel says is not exactly "development", is a real deployment. */
export function isRealDeployment(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const v = (process.env.VERCEL_ENV ?? "").trim();
  return v !== "" && v !== "development";
}

/** ชั้น action บังคับ session/member ไหม: deployment จริงเสมอ · local dev ต้องตั้ง AUTH_GATE=on เอง */
export function actionGateEnforced(): boolean {
  return isRealDeployment() || process.env.AUTH_GATE === "on";
}
