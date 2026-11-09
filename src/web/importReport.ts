import type { AtResponse } from '../at/engine';
import type { Profile } from '../catalog/types';
import { parseResponse } from '../parse';
import type { ScanItem, ScanReport } from '../scan/scanner';
import { CAPTURE_FORMAT, CAPTURE_VERSION } from './bookmarklets';
import { WEB_DIALECTS } from './dialects';
import type { WebDialect, WebEndpoint } from './dialects';

export interface WebCapture {
  format: 'modemlens-web-capture';
  version: 1;
  dialect: string;
  capturedAt: string;
  responses: { id: string; status: number; body: string }[];
}

export const MAX_CAPTURE_BYTES = 1_000_000;

/** The message is shown as it is, so it is written for a person and never repeats what the file holds. */
export class InvalidCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCaptureError';
  }
}

export const CAPTURE_TOO_LARGE = 'This file is too large to be a modem capture. Nothing was imported.';
const NOT_A_CAPTURE = 'This file is not a modem capture from the ModemLens bookmark. Nothing was imported.';
const UNKNOWN_CONTENT = 'This capture is from a modem type or a version this ModemLens does not know. Nothing was imported.';
const NOTHING_USABLE = 'This capture holds no readable answers from a modem. Nothing was imported.';

const CAPTURE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const HIGHEST_STATUS = 599;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new InvalidCaptureError(NOT_A_CAPTURE);
  }
}

function checkedAnswers(raw: unknown, dialect: WebDialect): Array<{ endpoint: WebEndpoint; status: number; body: string }> {
  if (!Array.isArray(raw) || raw.length === 0) throw new InvalidCaptureError(NOT_A_CAPTURE);
  const seen = new Set<string>();
  return raw.map((answer: unknown) => {
    if (!isRecord(answer)) throw new InvalidCaptureError(NOT_A_CAPTURE);
    const { id, status, body } = answer;
    if (typeof body !== 'string' || !Number.isInteger(status) || (status as number) < 0 || (status as number) > HIGHEST_STATUS) {
      throw new InvalidCaptureError(NOT_A_CAPTURE);
    }
    const endpoint = dialect.endpoints.find((e) => e.id === id);
    if (!endpoint) throw new InvalidCaptureError(UNKNOWN_CONTENT);
    if (seen.has(endpoint.id)) throw new InvalidCaptureError(NOT_A_CAPTURE);
    seen.add(endpoint.id);
    return { endpoint, status: status as number, body };
  });
}

/** Everything but the raw body comes from our own table, never from the file. */
function toItem(endpoint: WebEndpoint, status: number, body: string): ScanItem {
  const command = `GET ${endpoint.path}`;
  const answer: AtResponse = { command, status: 'ok', lines: body === '' ? [] : body.split(/\r?\n/), durationMs: 0 };
  const item = { id: `web:${endpoint.id}`, command, category: 'web' as const, parser: endpoint.parser };
  if (status >= 200 && status < 300 && parseResponse(endpoint.parser, answer)) return { ...item, state: 'done', response: answer };
  return {
    ...item,
    state: status === 0 ? 'failed' : 'unsupported',
    response: { ...answer, status: 'error', errorDetail: status === 0 ? 'no answer' : `HTTP ${status}` },
  };
}

/**
 * A capture file is untrusted: it is checked field by field, only known answers pass, and they reach the
 * screen and the exports only as the same report and through the same parsers as a scan.
 */
export function importWebCapture(json: string): ScanReport {
  if (json.length > MAX_CAPTURE_BYTES) throw new InvalidCaptureError(CAPTURE_TOO_LARGE);
  const capture = parseJson(json);
  if (!isRecord(capture) || capture.format !== CAPTURE_FORMAT) throw new InvalidCaptureError(NOT_A_CAPTURE);
  if (capture.version !== CAPTURE_VERSION) throw new InvalidCaptureError(UNKNOWN_CONTENT);
  const dialect = WEB_DIALECTS.find((d) => d.id === capture.dialect);
  if (!dialect) throw new InvalidCaptureError(UNKNOWN_CONTENT);
  const { capturedAt } = capture;
  if (typeof capturedAt !== 'string' || !CAPTURE_TIME.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
    throw new InvalidCaptureError(NOT_A_CAPTURE);
  }
  const items = checkedAnswers(capture.responses, dialect).map((a) => toItem(a.endpoint, a.status, a.body));
  if (!items.some((i) => i.state === 'done')) throw new InvalidCaptureError(NOTHING_USABLE);

  const profile: Profile = { id: `web-${dialect.id}`, label: dialect.label, verified: dialect.verified, match: {}, commands: [], denyCommands: [] };
  return { startedAt: capturedAt, profile, items, commandList: [] };
}
