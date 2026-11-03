// Reads the first sheet of an .xlsx file into a grid of cells, in the browser.
// An .xlsx is a zip of XML (the writer next door, lib/xlsx.ts, builds one the
// same way); this unzips it with fflate and walks the sheet: shared strings,
// inline strings, numbers. Enough for a bank statement — no formulas are
// evaluated (an exported statement stores values), no dates are converted
// (statements write them as text).

export type ReadCell = string | number | null;

const colIndex = (ref: string): number => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const textOf = (el: Element | null | undefined): string =>
  el ? Array.from(el.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("") : "";

export async function readFirstSheet(file: ArrayBuffer): Promise<ReadCell[][]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(file));
  } catch {
    throw new Error("Это не файл Excel (.xlsx). Выгрузите выписку в формате Excel.");
  }
  const xml = (path: string): Document | null => {
    const bytes = entries[path];
    return bytes ? new DOMParser().parseFromString(strFromU8(bytes), "application/xml") : null;
  };

  // The first sheet named in the workbook, through its relationship; else sheet1.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = xml("xl/workbook.xml");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const firstSheet = workbook?.getElementsByTagName("sheet")[0];
  const relId = firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  if (relId && rels) {
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === relId);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = xml(sheetPath);
  if (!sheet) throw new Error("В файле не найден лист с данными");

  const shared = xml("xl/sharedStrings.xml");
  const strings = shared ? Array.from(shared.getElementsByTagName("si")).map((si) => textOf(si)) : [];

  const grid: ReadCell[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const rowIndex = Number(row.getAttribute("r") ?? grid.length + 1) - 1;
    const cells: ReadCell[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? null;
      let value: ReadCell = null;
      if (type === "s") value = v !== null ? strings[Number(v)] ?? null : null;
      else if (type === "inlineStr") value = textOf(c.getElementsByTagName("is")[0]);
      else if (type === "str" || type === "b" || type === "e") value = v;
      else if (v !== null) value = Number.isFinite(Number(v)) ? Number(v) : v;
      cells[colIndex(c.getAttribute("r") ?? "A")] = value;
    }
    grid[rowIndex] = Array.from(cells, (x) => (x === undefined ? null : x));
  }
  return Array.from(grid, (r) => r ?? []);
}
