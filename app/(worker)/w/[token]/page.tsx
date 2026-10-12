import { loadWorkerView } from "@/lib/jobs/worker-server";
import { WorkerApp } from "@/components/domain/jobs/worker/WorkerApp";

// /w/<token> — หน้าช่าง (สาธารณะ): สแกน QR บนใบงาน → ระบุตัว (ชื่อ+PIN) → รับงาน / ส่งต่อ
// server component อ่านผ่าน loadWorkerView (hash token ก่อนถึง DB · sanitize แบบ allowlist) แล้วส่งให้ client เฉพาะ view ที่ปลอดภัย
// force-dynamic: ทุกครั้งต้องเห็นสถานะสด + ไม่แคช (token ใน URL)
export const dynamic = "force-dynamic";

export default async function WorkerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await loadWorkerView(token);

  if (!res.ok) {
    const closed = res.code === "job_closed";
    return (
      <div role="alert" className="space-y-3 pt-8 text-center">
        <p className="text-3xl font-bold text-zinc-900">{closed ? "ใบงานนี้ปิดแล้ว" : "เปิดใบงานไม่ได้"}</p>
        <p className="text-xl text-zinc-800">{res.error}</p>
      </div>
    );
  }
  return <WorkerApp token={token} view={res.data} />;
}
