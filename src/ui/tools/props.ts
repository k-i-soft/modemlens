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

/** Runs `work` once the modem is free. Waits up to `tries` turns, because auto refresh or another tool may hold it for a moment. */
export async function hold<T>(p: Pick<ToolProps, 'begin' | 'end'>, work: () => Promise<T>, tries = 24, delayMs = 250): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    if (p.begin()) {
      try {
        return await work();
      } finally {
        p.end();
      }
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return null;
}

/** For the first read of a tool, when every tool reads at the same moment: a longer wait. */
export function holdWhenFree<T>(p: Pick<ToolProps, 'begin' | 'end'>, work: () => Promise<T>): Promise<T | null> {
  return hold(p, work, 60);
}
