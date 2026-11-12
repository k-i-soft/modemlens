import type { AtResponse } from '../at/engine';
import { STANDARD_PARSERS } from './standard';
import type { Field, Parser } from './standard';
import { QUECTEL_PARSERS } from './quectel';
import { WEB_PARSERS } from './web';
import { HUAWEI_PARSERS } from './huawei';
import { SIMCOM_PARSERS } from './simcom';

export type { Field, Sensitivity } from './standard';
export { buildSummary, NO_SIM } from './summary';
export { LIMITED_ACCESS } from './standard';
export { WEB_PARSER_NAMES } from './web';
export type { Summary } from './summary';

const PARSERS: Record<string, Parser> = { ...STANDARD_PARSERS, ...QUECTEL_PARSERS, ...HUAWEI_PARSERS, ...SIMCOM_PARSERS, ...WEB_PARSERS };

export const KNOWN_PARSERS: string[] = Object.keys(PARSERS);

/** Never throws. Null for an unknown parser, a non-ok response or one that cannot be interpreted. */
export function parseResponse(parser: string, r: AtResponse): Field[] | null {
  if (!Object.prototype.hasOwnProperty.call(PARSERS, parser)) return null;
  if (r.status !== 'ok') return null;
  try {
    const fields = PARSERS[parser](r);
    return fields.length > 0 ? fields : null;
  } catch {
    return null;
  }
}
