// A streaming ZIP writer (stored, no compression). Entries are produced one at a time and written with a
// data descriptor, so a rescue with hundreds of photos never has to fit in memory at once.

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array; modified?: Date };
const encoder = new TextEncoder();

function dosTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return { time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1), date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate() };
}

function localHeader(name: Uint8Array, when: { time: number; date: number }) {
  const h = new DataView(new ArrayBuffer(30));
  h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
  h.setUint16(6, 0x0808, true); // bit 3: sizes follow the data; bit 11: UTF-8 names
  h.setUint16(8, 0, true); h.setUint16(10, when.time, true); h.setUint16(12, when.date, true);
  h.setUint32(14, 0, true); h.setUint32(18, 0, true); h.setUint32(22, 0, true);
  h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
  return new Uint8Array(h.buffer);
}

function descriptor(crc: number, size: number) {
  const d = new DataView(new ArrayBuffer(16));
  d.setUint32(0, 0x08074b50, true); d.setUint32(4, crc, true); d.setUint32(8, size, true); d.setUint32(12, size, true);
  return new Uint8Array(d.buffer);
}

function centralHeader(name: Uint8Array, when: { time: number; date: number }, crc: number, size: number, offset: number) {
  const h = new DataView(new ArrayBuffer(46));
  h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0808, true); h.setUint16(10, 0, true);
  h.setUint16(12, when.time, true); h.setUint16(14, when.date, true); h.setUint32(16, crc, true); h.setUint32(20, size, true); h.setUint32(24, size, true);
  h.setUint16(28, name.length, true); h.setUint32(42, offset, true);
  return new Uint8Array(h.buffer);
}

function endRecord(count: number, size: number, offset: number) {
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Uint8Array(e.buffer);
}

/** Streams the entries as one ZIP file. `entries` is pulled lazily, one entry per read of the stream. */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const iterator = entries[Symbol.asyncIterator]();
  const central: Uint8Array[] = [];
  let offset = 0, centralSize = 0, count = 0, finished = false;
  const names = new Set<string>();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        const next = await iterator.next();
        if (!next.done) {
          const { name, data, modified } = next.value;
          if (names.has(name)) throw new Error(`Duplicate zip entry ${name}`);
          names.add(name);
          const nameBytes = encoder.encode(name), when = dosTime(modified ?? new Date()), crc = crc32(data);
          const head = localHeader(nameBytes, when);
          controller.enqueue(head); controller.enqueue(nameBytes); controller.enqueue(data); controller.enqueue(descriptor(crc, data.length));
          const c = centralHeader(nameBytes, when, crc, data.length, offset);
          central.push(c, nameBytes); centralSize += c.length + nameBytes.length;
          offset += head.length + nameBytes.length + data.length + 16; count++;
          return;
        }
        for (const part of central) controller.enqueue(part);
        controller.enqueue(endRecord(count, centralSize, offset));
        finished = true; controller.close();
      } catch (error) { finished = true; controller.error(error); }
    },
    async cancel() { await iterator.return?.(); },
  });
}
