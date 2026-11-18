// lib/ring-builder/viewer/ring-types.ts — รูปร่างของ "แหวนที่ viewer วาดได้" (pure · type อย่างเดียว)
// BypassRing (bypass-ring.ts) เข้ากันได้เชิงโครงสร้าง — ไม่ต้องแก้ bypass-ring.ts · แบบแถว (row-ring.ts) คืนรูปเดียวกัน
import type { CameraFrame, RingGem, RingMesh } from "./bypass-ring";

export interface ViewerRing {
  metal: RingMesh;
  /** เรียงตามที่ designTints() คาดไว้ — ไขว้: [พลอยไข่บน, ล่าง, CZ, CZ] · แถว: ซ้าย → ขวา */
  gems: RingGem[];
  frame: CameraFrame;
  vertexCount: number;
}
