import type { ClassificationRowInput } from "@bakery-os/shared";

// Reads a CSV/TSV file of «артикул; название; тип; категория; подкатегория».
// The delimiter (;  ,  or tab) is detected, quotes and a leading BOM are handled,
// and a header row — if there is one — decides the column order; without one the
// columns are taken in the order above. Only SKU, category and subcategory carry
// meaning; name and type are cross-checks.

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

const HEADER_KEYS: Record<string, keyof ClassificationRowInput> = {
  артикул: "sku",
  sku: "sku",
  название: "name",
  товар: "name",
  name: "name",
  тип: "type",
  type: "type",
  новый_тип: "type",
  категория: "category",
  category: "category",
  новая_категория: "category",
  подкатегория: "subcategory",
  subcategory: "subcategory",
  новая_подкатегория: "subcategory",
};

export function parseClassificationFile(text: string): ClassificationRowInput[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const first = lines[0];
  const delimiter = [";", "\t", ","].map((d) => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const header = splitLine(first, delimiter).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const mapped = header.map((h) => HEADER_KEYS[h]);
  const hasHeader = mapped.includes("sku");
  const order: (keyof ClassificationRowInput)[] = hasHeader
    ? mapped.map((m) => m ?? ("name" as keyof ClassificationRowInput))
    : ["sku", "name", "type", "category", "subcategory"];
  const body = hasHeader ? lines.slice(1) : lines;
  return body.map((line) => {
    const cells = splitLine(line, delimiter);
    const row: ClassificationRowInput = { sku: "" };
    order.forEach((key, i) => {
      if (hasHeader && mapped[i] === undefined) return; // an unknown column is ignored (e.g. «под реализацию»)
      row[key] = cells[i] ?? "";
    });
    return row;
  });
}
