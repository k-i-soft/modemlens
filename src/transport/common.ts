/** The data and disconnect callbacks of a transport. A loss is reported once, even to a late listener. */
export class TransportListeners {
  private dataCbs: Array<(chunk: Uint8Array) => void> = [];
  private disconnectCbs: Array<(reason: string) => void> = [];
  private lostReason: string | undefined;

  onData(cb: (chunk: Uint8Array) => void): void {
    this.dataCbs.push(cb);
  }

  onDisconnect(cb: (reason: string) => void): void {
    const reason = this.lostReason;
    if (reason !== undefined) queueMicrotask(() => cb(reason));
    else this.disconnectCbs.push(cb);
  }

  data(chunk: Uint8Array): void {
    for (const cb of this.dataCbs) cb(chunk);
  }

  lost(reason: string): void {
    if (this.lostReason !== undefined) return;
    this.lostReason = reason;
    for (const cb of this.disconnectCbs) cb(reason);
  }
}

/** Settles like `call`, or rejects with `timeoutError()` once `ms` have passed. */
export function withTimeout<T>(call: Promise<T>, ms: number, timeoutError: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), ms);
  });
  return Promise.race([call, expired]).finally(() => clearTimeout(timer));
}

export function errorName(e: unknown): string {
  return (e as { name?: string } | null)?.name ?? '';
}

/** Without a trailing period, because the callers put it inside a sentence. */
export function errorMessage(e: unknown): string {
  return ((e as { message?: string } | null)?.message ?? String(e)).replace(/\.$/, '');
}

/** "2c7c:6005": lowercase, with leading zeros. */
export function formatUsbId(vendorId: number, productId: number): string {
  const hex = (n: number) => n.toString(16).padStart(4, '0');
  return `${hex(vendorId)}:${hex(productId)}`;
}
