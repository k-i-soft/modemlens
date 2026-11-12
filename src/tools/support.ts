import { PING_TEST, pingDialect } from './ping';
import type { ToolId, ToolIo } from './types';

/**
 * Which tools this modem can use, found with read and test forms only. A tool appears only
 * when the modem answers its command, so nothing is offered that it does not know.
 */
export async function probeTools(io: ToolIo, profileId: string | undefined): Promise<Set<ToolId>> {
  const found = new Set<ToolId>();
  const probes: Array<[ToolId, string]> = [
    ['pin', 'AT+CPIN?'],
    ['ussd', 'AT+CUSD=?'],
    ['operator', 'AT+COPS?'],
    ['sms', 'AT+CMGF=?'],
  ];
  const dialect = pingDialect(profileId);
  if (dialect) probes.push(['ping', PING_TEST[dialect]]);
  for (const [tool, command] of probes) {
    const r = await io.send(command);
    if (r.status === 'disconnected') break;
    // A locked SIM answers +CPIN? with its state, other commands may refuse with a CME error.
    if (r.status === 'ok') found.add(tool);
  }
  return found;
}

/** Tools that have been run on a real modem of this profile. The others take the second confirmation. */
const VERIFIED: Partial<Record<string, ToolId[]>> = {
  // Four of four answered through AT+QPING on 2026-11-12.
  'quectel-ec200a': ['ping'],
};

export function toolVerified(tool: ToolId, profileId: string | undefined): boolean {
  return profileId !== undefined && (VERIFIED[profileId]?.includes(tool) ?? false);
}

/** Why no tool can be used right now, or undefined when they can. They need no profile. */
export function toolBlock(s: { connected: boolean; imported: boolean; scanning: boolean }): string | undefined {
  if (s.imported) return 'This report was imported from a file, so there is no modem to use the tools on.';
  if (!s.connected) return 'The tools need a connected modem.';
  if (s.scanning) return 'A scan is running. The tools wait for it, so that no command lands between the scan commands.';
  return undefined;
}
