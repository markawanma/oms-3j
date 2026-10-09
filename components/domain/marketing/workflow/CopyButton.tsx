"use client";

// CopyButton — คัดลอกข้อความ (ต่อส่วน / ทั้งก้อน) พร้อมแจ้ง "คัดลอกแล้ว" · ปุ่มสูง ≥ 44px บนมือถือ
// clipboard API ใช้ได้เฉพาะ secure context · ล้มเหลว → toast แจ้ง ไม่เงียบ

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function CopyButton({
  text,
  label = "คัดลอก",
  variant = "secondary",
  disabled = false,
  className = "",
}: {
  text: string;
  label?: string;
  variant?: "secondary" | "ghost" | "primary";
  disabled?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.push("คัดลอกแล้ว");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.push("คัดลอกไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    }
  }

  return (
    <Button type="button" variant={variant} disabled={disabled || !text} onClick={handleCopy} className={className}>
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {copied ? "คัดลอกแล้ว" : label}
    </Button>
  );
}
