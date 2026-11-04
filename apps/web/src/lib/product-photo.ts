import type { ProductDto } from "@bakery-os/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

// Address of a product's picture; `v` changes with every new photo, so the
// browser keeps each one for good and never shows a stale picture.
export function productPhotoUrl(product: Pick<ProductDto, "id" | "photoVersion">): string | null {
  return product.photoVersion ? `${API_URL}/products/${product.id}/photo?v=${product.photoVersion}` : null;
}

// A phone photo is several MB: shrink it in the browser to ≤ 480 px on the long
// side, JPEG — a till tile needs no more, and the server keeps it in the database.
export async function resizeProductPhoto(file: File, maxSide = 480): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Не удалось открыть картинку"));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Не удалось обработать картинку");
    ctx.fillStyle = "#ffffff"; // a transparent PNG becomes white, not black, as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
