import type { ScanReport } from '../scan/scanner';
import type { SharedReport } from './redact';

export { redactReport, shapeOf } from './redact';
export type { Shape, SharedItem, SharedReport } from './redact';

/** Full export is unmasked when given a ScanReport; a SharedReport is already masked. */
export function toJson(report: SharedReport | ScanReport): string {
  return JSON.stringify(report, null, 2);
}

const ZERO_WIDTH_SPACE = '\u200b';

/**
 * Modem text is data: neutralise HTML and Markdown structure characters, and whatever
 * a renderer would turn into a link on its own. Mention and e-mail detection can run on the
 * rendered text, where a backslash is gone, so `@` also gets a character that splits it from the name.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[`|\\[\]*_~#]/g, (c) => `\\${c}`)
    .replace(/@/g, `\\@${ZERO_WIDTH_SPACE}`)
    .replace(/:\/\//g, '\\://')
    .replace(/\bwww\./gi, (m) => `${m.slice(0, -1)}\\.`)
    .replace(/\r?\n/g, ' ');
}

const isShared = (r: SharedReport | ScanReport): r is SharedReport =>
  (r as SharedReport).redacted === true;

export function toMarkdown(report: SharedReport | ScanReport): string {
  const out: string[] = [];
  const shared = isShared(report);
  out.push(shared ? '# ModemLens report (redacted)' : '# ModemLens report (full, unmasked)', '');
  out.push(`- Started: ${esc(report.startedAt)}`);
  if (report.usb !== undefined) out.push(`- USB: ${esc(report.usb)}`);
  if (report.profile) out.push(`- Profile: ${esc(typeof report.profile === 'string' ? report.profile : report.profile.id)}`);
  if (!shared && report.interrupted) out.push(`- Interrupted: ${esc(report.interrupted)}`);
  out.push('', '## Items', '');
  for (const item of report.items) {
    out.push(`### ${esc(item.id)} (${esc(item.command)}) - ${item.state}`, '');
    if (shared) {
      const s = item as SharedReport['items'][number];
      for (const f of s.fields ?? []) out.push(`- ${esc(f.label)}: ${esc(f.value)}`);
      if (s.lines?.length) out.push('', ...s.lines.map((l) => `    ${esc(l)}`));
      if (s.shape) out.push(`Shape: length ${s.shape.length}, ${s.shape.lines} line(s), ${esc(s.shape.classes)}`);
    } else {
      const r = (item as ScanReport['items'][number]).response;
      if (r) out.push(...r.lines.map((l) => `    ${esc(l)}`));
    }
    out.push('');
  }
  out.push('## Command list', '');
  out.push(report.commandList.length ? report.commandList.map(esc).join(', ') : '(none)', '');
  return out.join('\n');
}
