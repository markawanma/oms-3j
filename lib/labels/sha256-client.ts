// lib/labels/sha256-client.ts — BROWSER ONLY (uses window.crypto.subtle).
// Never import this from a server action / server component — it will throw
// at runtime there. The hash is computed client-side because the sha256 IS
// the dedupe key the backend uses as the storage filename (design §1:
// "{shop_id}/{yyyy-mm}/{sha256}.pdf") — the server never sees the raw file
// bytes until parseLabelFile downloads them back out of Storage.

export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
