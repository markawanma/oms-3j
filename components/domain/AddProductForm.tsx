"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { createProduct } from "@/lib/actions/products";

export function AddProductForm() {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [initialStock, setInitialStock] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const stockNum = Number(initialStock);
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      setError("สต็อกเริ่มต้นต้องเป็นจำนวนเต็มไม่ติดลบ");
      return;
    }

    setSubmitting(true);
    const result = await createProduct({ sku, name, initialStock: stockNum });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      toast.push(result.error, "error");
      return;
    }

    toast.push(`เพิ่มสินค้า "${name}" เรียบร้อย`, "success");
    setSku("");
    setName("");
    setInitialStock("0");
    router.push("/stock");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {error && <ErrorBanner message={error} />}

      <div>
        <label htmlFor="sku" className="block text-sm font-medium text-slate-700">
          SKU
        </label>
        <input
          id="sku"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          required
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-base"
          placeholder="เช่น TSHIRT-BLK-M"
        />
      </div>

      <div>
        <label htmlFor="product-name" className="block text-sm font-medium text-slate-700">
          ชื่อสินค้า
        </label>
        <input
          id="product-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-base"
          placeholder="เช่น เสื้อยืดสีดำ ไซส์ M"
        />
      </div>

      <div>
        <label htmlFor="initial-stock" className="block text-sm font-medium text-slate-700">
          สต็อกเริ่มต้น
        </label>
        <input
          id="initial-stock"
          type="number"
          min={0}
          step={1}
          value={initialStock}
          onChange={(e) => setInitialStock(e.target.value)}
          required
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-base"
        />
      </div>

      <Button type="submit" variant="primary" loading={submitting} className="w-full">
        เพิ่มสินค้า
      </Button>
    </form>
  );
}
