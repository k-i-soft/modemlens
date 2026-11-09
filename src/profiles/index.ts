import type { Profile } from '../catalog/types';
import ec200a from './quectel-ec200a.json';
import eg800 from './quectel-eg800.json';
import ec25 from './quectel-ec25.json';
import asr4e3c from './asr-1286-4e3c.json';

export const PROFILES: Profile[] = [ec200a, eg800, ec25, asr4e3c] as Profile[];

/** USB id ("vvvv:pppp") is tried first, then the model string. */
export function matchProfile(input: { usb?: string; model?: string }): Profile | undefined {
  if (input.usb) {
    const usb = input.usb.trim().toLowerCase();
    const hit = PROFILES.find(p => p.match.usb?.some(u => u.toLowerCase() === usb));
    if (hit) return hit;
  }
  if (input.model) {
    const model = input.model;
    return PROFILES.find(p => p.match.modelPattern && new RegExp(p.match.modelPattern, 'i').test(model));
  }
  return undefined;
}
