// Reads the first sheet of an old binary Excel file (.xls, «Excel 97–2003»,
// BIFF8 inside an OLE compound file) into a grid of cells. Banks still export
// statements this way (Банк ЦентрКредит does). Pure byte work, no DOM, no
// dependencies — enough for a statement: shared strings, inline strings,
// numbers (NUMBER / RK / MULRK) and cached formula results. Formatting,
// dates-as-numbers and other sheets are ignored.

export type XlsCell = string | number | null;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const f64 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);

const ENDOFCHAIN = 0xfffffffe;

// ── the OLE compound file: find the «Workbook» stream ───────────────────────
function workbookStream(file: Uint8Array): Uint8Array {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!sig.every((v, i) => file[i] === v)) throw new Error("Это не файл Excel 97–2003 (.xls)");
  const sectorSize = 1 << u16(file, 0x1e);
  const miniSectorSize = 1 << u16(file, 0x20);
  const firstDirSector = u32(file, 0x30);
  const miniCutoff = u32(file, 0x38);
  const firstMiniFat = u32(file, 0x3c);
  let difatNext = u32(file, 0x44);
  const sectorAt = (n: number) => file.subarray(512 + n * sectorSize, 512 + (n + 1) * sectorSize);

  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i += 1) {
    const s = u32(file, 0x4c + i * 4);
    if (s < ENDOFCHAIN - 1) fatSectors.push(s);
  }
  let guard = 0;
  while (difatNext < ENDOFCHAIN - 1 && guard++ < 10_000) {
    const sec = sectorAt(difatNext);
    for (let i = 0; i < sectorSize / 4 - 1; i += 1) {
      const s = u32(sec, i * 4);
      if (s < ENDOFCHAIN - 1) fatSectors.push(s);
    }
    difatNext = u32(sec, sectorSize - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const sec = sectorAt(s);
    for (let i = 0; i < sectorSize / 4; i += 1) fat.push(u32(sec, i * 4));
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    let s = start;
    while (s < ENDOFCHAIN - 1 && out.length < table.length + 1) {
      out.push(s);
      s = table[s] ?? ENDOFCHAIN;
    }
    return out;
  };
  const readChain = (start: number) => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((s, i) => out.set(sectorAt(s), i * sectorSize));
    return out;
  };

  const dir = readChain(firstDirSector);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = u16(dir, o + 0x40);
    let name = "";
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i += 1) name += String.fromCharCode(u16(dir, o + i * 2));
    entries.push({ name, type: dir[o + 0x42], start: u32(dir, o + 0x74), size: u32(dir, o + 0x78) });
  }
  const book = entries.find((e) => e.type === 2 && (e.name === "Workbook" || e.name === "Book"));
  if (!book) throw new Error("В файле .xls нет листов");
  if (book.size >= miniCutoff) return readChain(book.start).subarray(0, book.size);

  // A small workbook lives in the mini stream.
  const root = entries.find((e) => e.type === 5);
  if (!root) throw new Error("Файл .xls повреждён");
  const miniStream = readChain(root.start);
  const miniFat: number[] = [];
  const mf = readChain(firstMiniFat);
  for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(u32(mf, i));
  const sectors = chain(book.start, miniFat);
  const out = new Uint8Array(sectors.length * miniSectorSize);
  sectors.forEach((s, i) => out.set(miniStream.subarray(s * miniSectorSize, (s + 1) * miniSectorSize), i * miniSectorSize));
  return out.subarray(0, book.size);
}

// ── BIFF8 records ───────────────────────────────────────────────────────────
function decodeRk(rk: number): number {
  const scaled = (rk & 1) === 1;
  let v: number;
  if (rk & 2) {
    v = rk >> 2; // signed 30-bit integer
  } else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, rk & 0xfffffffc, true);
    v = buf.getFloat64(0, true);
  }
  return scaled ? v / 100 : v;
}

// Reads an XLUnicodeString that may run across CONTINUE records (`segments`).
class SegmentReader {
  seg = 0;
  pos = 0;
  constructor(private segments: Uint8Array[]) {}
  private ensure() {
    while (this.seg < this.segments.length && this.pos >= this.segments[this.seg].length) {
      this.seg += 1;
      this.pos = 0;
    }
  }
  byte(): number {
    this.ensure();
    return this.segments[this.seg][this.pos++];
  }
  u16(): number {
    return this.byte() | (this.byte() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number) {
    for (let i = 0; i < n; i += 1) this.byte();
  }
  string(): string {
    const cch = this.u16();
    let flags = this.byte();
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    let out = "";
    for (let i = 0; i < cch; i += 1) {
      this.ensureForChar();
      if (this.atSegmentStart && i > 0) flags = this.byte(); // a continued string restates its width
      out += String.fromCharCode(flags & 0x01 ? this.u16() : this.byte());
    }
    this.skip(runs * 4 + ext);
    return out;
  }
  private atSegmentStart = false;
  private ensureForChar() {
    const before = this.seg;
    this.ensure();
    this.atSegmentStart = this.seg !== before || this.pos === 0;
    if (this.seg === before && this.pos !== 0) this.atSegmentStart = false;
  }
}

export function readXlsFirstSheet(file: Uint8Array): XlsCell[][] {
  const wb = workbookStream(file);
  type Rec = { type: number; data: Uint8Array };
  const records: Rec[] = [];
  for (let o = 0; o + 4 <= wb.length; ) {
    const type = u16(wb, o);
    const len = u16(wb, o + 2);
    records.push({ type, data: wb.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }

  const sst: string[] = [];
  const grid: XlsCell[][] = [];
  const put = (row: number, col: number, v: XlsCell) => {
    (grid[row] ??= [])[col] = v;
  };
  let substream = 0; // 0 = workbook globals, 1 = first sheet, >1 = later sheets
  let pendingFormula: { row: number; col: number } | null = null;

  for (let i = 0; i < records.length; i += 1) {
    const { type, data } = records[i];
    if (type === 0x0809) {
      substream += 1; // BOF
      continue;
    }
    if (type === 0x00fc && substream === 1) {
      // SST + its CONTINUE records
      const segments = [data.subarray(8)];
      while (records[i + 1]?.type === 0x003c) segments.push(records[++i].data);
      const r = new SegmentReader(segments);
      const unique = u32(data, 4);
      for (let k = 0; k < unique; k += 1) sst.push(r.string());
      continue;
    }
    if (substream !== 2) continue; // only the first worksheet's cells
    const row = u16(data, 0);
    const col = u16(data, 2);
    switch (type) {
      case 0x00fd: // LABELSST
        put(row, col, sst[u32(data, 6)] ?? "");
        break;
      case 0x0204: // LABEL
        put(row, col, new SegmentReader([data.subarray(6)]).string());
        break;
      case 0x0203: // NUMBER
        put(row, col, f64(data, 6));
        break;
      case 0x027e: // RK
        put(row, col, decodeRk(u32(data, 6)));
        break;
      case 0x00bd: {
        // MULRK
        const last = u16(data, data.length - 2);
        for (let c = col, o = 4; c <= last; c += 1, o += 6) put(row, c, decodeRk(u32(data, o + 2)));
        break;
      }
      case 0x0006: // FORMULA: a cached number, or a string in the next STRING record
        if (data[12] === 0xff && data[13] === 0xff) {
          if (data[6] === 0) pendingFormula = { row, col };
        } else put(row, col, f64(data, 6));
        break;
      case 0x0207: // STRING (result of the formula before it)
        if (pendingFormula) put(pendingFormula.row, pendingFormula.col, new SegmentReader([data]).string());
        pendingFormula = null;
        break;
      case 0x000a: // EOF of the first sheet: done
        return Array.from(grid, (r) => Array.from(r ?? [], (c) => (c === undefined ? null : c)));
    }
  }
  return Array.from(grid, (r) => Array.from(r ?? [], (c) => (c === undefined ? null : c)));
}
