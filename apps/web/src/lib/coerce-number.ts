// «1234.50» (what toFixed gives) and «12» become numbers; «007», a БИН (12
// digits), a phone, «—» and «нет данных» stay text, as does anything formatted
// with a currency sign.
export function coerceNumber(value: string): number | null {
  const text = value.trim().replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const digits = text.replace(/^-/, "").split(".")[0];
  if (digits.length > 1 && digits.startsWith("0")) return null;
  if (!text.includes(".") && digits.length >= 9) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
