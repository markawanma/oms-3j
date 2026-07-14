import { AddProductForm } from "@/components/domain/AddProductForm";

export default function AddProductPage() {
  return (
    <div>
      <h1 className="mb-3 text-xl font-bold text-slate-900">เพิ่มสินค้า</h1>
      <p className="mb-4 text-sm text-slate-500">
        เพิ่มสินค้าใหม่ด้วยตัวเอง (manual) พร้อมตั้งจำนวนสต็อกเริ่มต้น — ใช้เมื่อสินค้ายังไม่ได้ผูกกับช่องทางขาย
      </p>
      <AddProductForm />
    </div>
  );
}
