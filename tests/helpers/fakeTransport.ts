import type { Transport } from '../../src/transport/types';

interface Rule {
  when: string | RegExp;
  chunks: string[];
}

function decode(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return s;
}

function encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** In-memory transport. Everything written is recorded; replies are scripted. */
export class FakeTransport implements Transport {
  readonly kind = 'fake' as const;
  readonly label = 'Fake modem';
  /** Every write, decoded as latin1, exactly as sent (including the trailing CR). */
  readonly written: string[] = [];

  private dataCbs: Array<(chunk: Uint8Array) => void> = [];
  private disconnectCbs: Array<(reason: string) => void> = [];
  private rules: Rule[] = [];
  private closed = false;

  /**
   * Script a reply: when a write matches (string = exact match of the write
   * without trailing CR/LF; RegExp = test on the same), the chunks are emitted
   * synchronously, in order.
   */
  reply(when: string | RegExp, chunks: string[]): void {
    this.rules.push({ when, chunks });
  }

  /** Push text from the "modem" to the listeners. */
  emit(text: string): void {
    const bytes = encode(text);
    for (const cb of this.dataCbs) cb(bytes);
  }

  /** Push raw bytes from the "modem". */
  emitBytes(bytes: number[]): void {
    const chunk = Uint8Array.from(bytes);
    for (const cb of this.dataCbs) cb(chunk);
  }

  disconnect(reason = 'disconnected'): void {
    this.closed = true;
    for (const cb of this.disconnectCbs) cb(reason);
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('transport closed');
    const text = decode(data);
    this.written.push(text);
    const key = text.replace(/[\r\n]+$/, '');
    const rule = this.rules.find((r) => (typeof r.when === 'string' ? r.when === key : r.when.test(key)));
    if (rule) for (const chunk of rule.chunks) this.emit(chunk);
  }

  onData(cb: (chunk: Uint8Array) => void): void {
    this.dataCbs.push(cb);
  }

  onDisconnect(cb: (reason: string) => void): void {
    this.disconnectCbs.push(cb);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
