export type Category =
  | 'identity' | 'sim' | 'network' | 'signal' | 'bands'
  | 'data' | 'usbmode' | 'voice' | 'locks' | 'other';

export interface CatalogEntry {
  id: string;
  command: string;
  category: Category;
  /** 'auto' entries may be sent by the automatic scan, so they must be read-only. */
  phase: 'auto' | 'manual';
  timeoutMs?: number;
  parser?: string;
  needsSim?: boolean;
}

export interface Profile {
  id: string;
  label: string;
  verified: boolean;
  match: { usb?: string[]; modelPattern?: string };
  usb?: { atInterface?: number; avoidInterfaces?: number[] };
  commands: CatalogEntry[];
  denyCommands: string[];
}
