import type { ToolIo } from '../../tools/types';

/** What every tool gets from the panel. */
export interface ToolProps {
  io: ToolIo;
  /** Takes the modem. False means something else holds it, and nothing may be sent. */
  begin: () => boolean;
  end: () => void;
  /** Why the tool cannot be used now. */
  blocked?: string;
  profileId?: string;
  /** No write of this tool has run on this model yet. */
  unverified: boolean;
  hideIdentifiers: boolean;
}

export const BUSY = 'Another action is using the modem. Try again when it is done.';
export const HIDDEN = 'Hidden while "Hide identifiers" is on.';

/** Runs `work` while holding the modem. Null when the modem was not free. */
export async function hold<T>(p: Pick<ToolProps, 'begin' | 'end'>, work: () => Promise<T>): Promise<T | null> {
  if (!p.begin()) return null;
  try {
    return await work();
  } finally {
    p.end();
  }
}

/** For the first read of a tool: the other tools read at the same moment, so it waits its turn. */
export async function holdWhenFree<T>(p: Pick<ToolProps, 'begin' | 'end'>, work: () => Promise<T>, tries = 40, delayMs = 250): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const r = await hold(p, work);
    if (r !== null) return r;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return null;
}
