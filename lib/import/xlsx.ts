/**
 * Minimal .xlsx reader for the template import (issue #8): unzips with the platform's
 * DecompressionStream and reads cell values (numbers, text, booleans, cached formula results).
 * No macros, no formulas evaluated, no styles: only what the import needs, without a dependency.
 */

export type CellValue = number | string | boolean;
/** Cells by reference ("B4"); empty cells are absent. */
export type Sheet = Map<string, CellValue>;

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

/** Refuses zip bombs: the template's XML is well under 1 MB. */
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function readCentralDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: last 22 bytes + up to 64 KB of comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("not a zip");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new XlsxError("bad zip directory");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (flags & 1) throw new XlsxError("encrypted zip");
    entries.set(name, { method, compressedSize, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new XlsxError("zip entry too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function readEntry(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) return null;
  if (entry.size > MAX_ENTRY_BYTES) throw new XlsxError("zip entry too large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) throw new XlsxError("bad zip entry");
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let raw: Uint8Array;
  if (entry.method === 0) raw = data;
  else if (entry.method === 8) raw = await inflate(data, MAX_ENTRY_BYTES);
  else throw new XlsxError(`unsupported zip method ${entry.method}`);
  return new TextDecoder().decode(raw);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e.startsWith("#x") ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith("#") ? String.fromCodePoint(Number(e.slice(1))) : ENTITIES[e]!,
  );
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : undefined;
}

/** Concatenated text of every <t> inside `xml` (rich-text runs included, phonetic runs skipped). */
function textOf(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? "");
  return out;
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => textOf(m[1] ?? ""));
}

export function parseSheet(xml: string, shared: readonly string[]): Sheet {
  const cells: Sheet = new Map();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const tag = m[1]!;
    const body = m[2] ?? "";
    const ref = attr(tag, "r");
    if (!ref) continue;
    const type = attr(tag, "t") ?? "n";
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let value: CellValue | undefined;
    if (type === "inlineStr") value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
    else if (v === undefined) value = undefined;
    else if (type === "s") value = shared[Number(v)];
    else if (type === "str" || type === "e") value = decodeXml(v);
    else if (type === "b") value = v === "1";
    else {
      const n = Number(v);
      value = Number.isFinite(n) ? n : undefined;
    }
    if (value !== undefined && value !== "") cells.set(ref, value);
  }
  return cells;
}

/** Opens a workbook and returns a reader for its sheets by name. */
export async function openWorkbook(bytes: Uint8Array): Promise<{ sheetNames: string[]; sheet: (name: string) => Promise<Sheet | null> }> {
  const entries = readCentralDirectory(bytes);
  const workbook = await readEntry(bytes, entries, "xl/workbook.xml");
  const rels = await readEntry(bytes, entries, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new XlsxError("not a workbook");
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, "Id");
    const target = attr(m[1]!, "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const sheets = new Map<string, string>();
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1]!, "name");
    const id = attr(m[1]!, "r:id");
    const target = id ? targets.get(id) : undefined;
    if (name && target) sheets.set(name, target);
  }
  const sharedXml = await readEntry(bytes, entries, "xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  return {
    sheetNames: [...sheets.keys()],
    async sheet(name) {
      const path = sheets.get(name);
      const xml = path ? await readEntry(bytes, entries, path) : null;
      return xml === null ? null : parseSheet(xml, shared);
    },
  };
}
