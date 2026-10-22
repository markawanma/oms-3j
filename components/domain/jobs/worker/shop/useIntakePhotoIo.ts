"use client";

// useIntakePhotoIo — ประกอบ io ของ useShopPhotos จาก server action ของช่าง (lib/actions/job-worker) ที่เดียว
// ใช้ร่วม ShopOpenFlow (W-8) และ ShopJobPhotosScreen (W-10) — hook useShopPhotos เองไม่ import server action (ฉีดผ่านที่นี่) · token ร้านอยู่ใน closure เท่านั้น ไม่ลง storage/log

import { useMemo } from "react";
import { intakeListPhotos, intakeRemovePhoto, intakeSetPrimaryPhoto, intakeUploadPhoto } from "@/lib/actions/job-worker";
import type { PhotoRef, ShopPhotoIo } from "@/components/domain/jobs/worker/shop/useShopPhotos";

/** อ้างใบ (idemKey | jobId) → รูปร่างที่ action รับ */
const refInput = (ref: PhotoRef) => ("idemKey" in ref ? { idemKey: ref.idemKey } : { jobId: ref.jobId });

export function useIntakePhotoIo(token: string): ShopPhotoIo {
  return useMemo<ShopPhotoIo>(
    () => ({
      upload: (fd) => intakeUploadPhoto(token, fd),
      remove: (photoId) => intakeRemovePhoto(token, photoId),
      list: (ref) => intakeListPhotos(token, ref),
      setPrimary: (ref, photoId) => intakeSetPrimaryPhoto(token, { ...refInput(ref), photoId }),
    }),
    [token],
  );
}
