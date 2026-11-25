import { SUPPLIER_INTAKE_PHOTO_MAX_CHARS } from "@bakery-os/shared";

// A page of a supplier's накладная photographed on a phone is several MB. It is shrunk in the browser
// to a JPEG that still reads (small print, handwriting) and fits one request: 1600 px on the long side,
// then smaller / rougher until it is under the limit.
export async function shrinkIntakePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Не удалось открыть фото"));
      el.src = url;
    });
    for (const [side, quality] of [[1600, 0.72], [1600, 0.6], [1400, 0.55], [1200, 0.5], [1000, 0.45]] as const) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Не удалось обработать фото");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= SUPPLIER_INTAKE_PHOTO_MAX_CHARS) return dataUrl;
    }
    throw new Error("Фото слишком большое — снимите ещё раз");
  } finally {
    URL.revokeObjectURL(url);
  }
}
