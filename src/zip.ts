// Zip files, for the exports of one customer and of one firm (slice H of
// docs/build-brief.md), written a piece at a time with fflate, so a large
// file never has to sit in memory whole. Text is compressed; recordings are
// stored as they are, since mp3 is compressed already.
//
// Each file in the zip is given the clock's time, so nothing here reads the
// system time (rule 19). fflate writes it as the time of day in UTC.

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { Instant } from './clock';

/** Where the zip's bytes go, in order: a file being written, or a response. */
export type ZipSink = (chunk: Uint8Array) => Promise<void>;

/** One file being written into the zip. Write it whole, then end it, before the next. */
export interface ZipEntry {
  write(chunk: Uint8Array | string): Promise<void>;
  end(): Promise<void>;
}

const encoder = new TextEncoder();

export class ZipWriter {
  private readonly zip: Zip;
  private readonly waiting: Uint8Array[] = [];
  private failed: Error | null = null;
  private readonly at: Date;

  constructor(
    private readonly sink: ZipSink,
    at: Instant,
  ) {
    this.at = new Date(at);
    this.zip = new Zip((error, chunk) => {
      if (error !== null) {
        this.failed = error;
        return;
      }
      this.waiting.push(chunk);
    });
  }

  /** Starts a file in the zip: compressed for text, stored as it is for a recording. */
  entry(name: string, how: 'compress' | 'store'): ZipEntry {
    if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
      throw new RangeError('A name in a zip holds plain letters, numbers and dots only');
    }
    const file = how === 'compress' ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    file.mtime = this.at;
    this.zip.add(file);
    return {
      write: async (chunk) => {
        file.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk, false);
        await this.flush();
      },
      end: async () => {
        file.push(new Uint8Array(0), true);
        await this.flush();
      },
    };
  }

  /** Adds a whole text file. */
  async text(name: string, text: string): Promise<void> {
    const entry = this.entry(name, 'compress');
    await entry.write(text);
    await entry.end();
  }

  /** Adds a file read from a stream, stored as it is. */
  async stream(name: string, body: ReadableStream<Uint8Array>): Promise<void> {
    const entry = this.entry(name, 'store');
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await entry.write(value);
    }
    await entry.end();
  }

  /** Ends the zip, writing its table of contents. */
  async finish(): Promise<void> {
    this.zip.end();
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.failed !== null) throw this.failed;
    for (let chunk = this.waiting.shift(); chunk !== undefined; chunk = this.waiting.shift()) {
      await this.sink(chunk);
    }
  }
}

/** A whole zip in memory, for a small one such as one customer's export. */
export async function zipInMemory(at: Instant, fill: (zip: ZipWriter) => Promise<void>): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  const zip = new ZipWriter((chunk) => {
    chunks.push(chunk);
    return Promise.resolve();
  }, at);
  await fill(zip);
  await zip.finish();
  const whole = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.length;
  }
  return whole;
}

/**
 * One row of a CSV file, as a spreadsheet reads it. A cell that starts with
 * a sign a spreadsheet takes as a formula (= + - @) is written with a quote
 * mark first, so words a caller said can never run as a formula on the
 * owner's computer (rule 17).
 */
export function csvRow(cells: readonly (string | number | null)[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

function csvCell(cell: string | number | null): string {
  if (cell === null) return '';
  const text = typeof cell === 'number' ? String(cell) : /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
