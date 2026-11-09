import { describe, expect, test } from 'vitest';
import { importWebCapture, InvalidCaptureError, MAX_CAPTURE_BYTES } from '../../src/web/importReport';
import { buildDashboard } from '../../src/ui/dashboard';
import { hilinkCapture, INFORMATION, PLMN, SIGNAL } from './fixtures';

const rejected = (json: string) => expect(() => importWebCapture(json)).toThrow(InvalidCaptureError);
const answer = (id: string, body: string, status = 200) => ({ id, status, body });

describe('importWebCapture rejects', () => {
  test.each([
    ['not json', 'hello'],
    ['null', 'null'],
    ['a list', '[]'],
    ['empty', ''],
  ])('%s', (_n, json) => rejected(json));

  test('import rejects wrong format or version', () => {
    rejected(hilinkCapture({ format: 'something-else' }));
    rejected(hilinkCapture({ version: 2 }));
    rejected(hilinkCapture({ version: '1' }));
  });

  test('import rejects unknown endpoint id', () => {
    rejected(hilinkCapture({ responses: [answer('information', INFORMATION), answer('sms-list', INFORMATION)] }));
  });

  test('an unknown dialect, inherited name included', () => {
    rejected(hilinkCapture({ dialect: 'nokia' }));
    rejected(hilinkCapture({ dialect: '__proto__' }));
  });

  test('a capture whose answers have the wrong shape', () => {
    rejected(hilinkCapture({ responses: 'x' }));
    rejected(hilinkCapture({ responses: [] }));
    rejected(hilinkCapture({ responses: [{ id: 'information', status: '200', body: INFORMATION }] }));
    rejected(hilinkCapture({ responses: [{ id: 'information', status: 200, body: 5 }] }));
    rejected(hilinkCapture({ responses: [{ id: 'information', status: 99999, body: INFORMATION }] }));
    rejected(hilinkCapture({ responses: [null] }));
    rejected(hilinkCapture({ responses: [answer('information', INFORMATION), answer('information', INFORMATION)] }));
  });

  test('a capture time that is not a time', () => {
    rejected(hilinkCapture({ capturedAt: 'yesterday' }));
    rejected(hilinkCapture({ capturedAt: 5 }));
    rejected(hilinkCapture({ capturedAt: '2026-99-99T00:00:00.000Z' }));
  });

  test('oversized capture rejected', () => {
    rejected(hilinkCapture({ padding: 'x'.repeat(MAX_CAPTURE_BYTES) }));
  });

  test('a capture with nothing usable in it', () => {
    rejected(hilinkCapture({ responses: [answer('information', '<html></html>'), answer('signal', '', 0)] }));
  });

  test('the message never repeats what the file holds', () => {
    try {
      importWebCapture(hilinkCapture({ format: '<b>123456789012345</b>' }));
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('123456789012345');
    }
  });
});

describe('importWebCapture builds a report', () => {
  test('one web item per answer, parser taken from the dialect', () => {
    const r = importWebCapture(hilinkCapture());
    expect(r.startedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(r.commandList).toEqual([]);
    expect(r.items.map((i) => [i.id, i.command, i.category, i.state, i.parser])).toEqual([
      ['web:information', 'GET /api/device/information', 'web', 'done', 'hilink_information'],
      ['web:signal', 'GET /api/device/signal', 'web', 'done', 'hilink_signal'],
      ['web:current-plmn', 'GET /api/net/current-plmn', 'web', 'done', 'hilink_plmn'],
    ]);
    expect(r.items[0].response?.lines.join('\n')).toBe(INFORMATION);
  });

  test('marks the dialect through the profile', () => {
    expect(importWebCapture(hilinkCapture()).profile).toMatchObject({ id: 'web-hilink', verified: true });
    const zte = importWebCapture(JSON.stringify({
      format: 'modemlens-web-capture', version: 1, dialect: 'zte', capturedAt: '2026-01-02T03:04:05.000Z',
      responses: [{ id: 'status', status: 200, body: '{"modem_model":"DEMO-MIFI"}' }],
    }));
    expect(zte.profile).toMatchObject({ id: 'web-zte', verified: false });
  });

  test('an answer that failed is kept as failed and not parsed', () => {
    const r = importWebCapture(hilinkCapture({
      responses: [answer('information', INFORMATION), answer('signal', '<error><code>1</code></error>'), answer('current-plmn', '', 0)],
    }));
    expect(r.items.map((i) => i.state)).toEqual(['done', 'unsupported', 'failed']);
    expect(r.items[1].response).toMatchObject({ status: 'error', errorDetail: 'HTTP 200' });
    expect(r.items[2].response?.errorDetail).toBe('no answer');
  });

  test('a good body with a bad status is not trusted', () => {
    const r = importWebCapture(hilinkCapture({ responses: [answer('information', INFORMATION), answer('signal', SIGNAL, 500)] }));
    expect(r.items[1].state).toBe('unsupported');
  });

  test('import never executes or renders markup', () => {
    const r = importWebCapture(hilinkCapture({
      responses: [
        answer('information', '<response><DeviceName>&lt;script&gt;alert(1)&lt;/script&gt;</DeviceName></response>'),
        answer('signal', '<script>alert(2)</script>'),
      ],
    }));
    expect(buildDashboard(r).identity.model).toBe('<script>alert(1)</script>');
    expect(r.items[1].state).toBe('unsupported');
    expect(r.items[1].response?.lines).toEqual(['<script>alert(2)</script>']);
    expect(document.querySelectorAll('script').length).toBe(0);
  });

  test('extra keys in the file go nowhere', () => {
    const r = importWebCapture(hilinkCapture({ usb: 'evil', profile: { id: 'evil' }, interrupted: 'evil' }));
    expect(JSON.stringify(r)).not.toContain('evil');
  });
});

describe('the Overview of an imported report', () => {
  const report = importWebCapture(hilinkCapture());

  test('fills the same dashboard as a scan', () => {
    const d = buildDashboard(report);
    expect(d.identity).toMatchObject({
      manufacturer: 'Huawei', model: 'DEMO-STICK-1', firmware: 'DEMOFW(FAKE)', imei: '123456789012345', profileId: 'web-hilink', verified: true,
    });
    expect(d.signal.values.map((v) => [v.metric, v.value])).toEqual([['rsrp', -86], ['rsrq', -5], ['sinr', 20], ['rssi', -63]]);
    expect(d.signal.bars).toBe(4);
    expect(d.bands.items).toEqual([{ band: 3, active: true }]);
    expect(d.chips.find((c) => c.key === 'operator')?.value).toBe('Demo Mobile');
    expect(d.chips.find((c) => c.key === 'technology')?.value).toBe('LTE');
    expect(d.network).toEqual({ word: 'On the network', tone: 'ok' });
    expect(d.sim).toMatchObject({ iccid: '98000000000000000099', imsi: '001010123456789', msisdn: '+0000000001' });
    const cell = Object.fromEntries(d.cell.map((r) => [r.key, r.value]));
    expect(cell).toMatchObject({ plmn: '00101', earfcn: '1850', ul_earfcn: '19850', cell_id: '7654321', pci: '201', tac: '4321', dl_bandwidth_mhz: '20' });
    const details = Object.fromEntries(d.device.details!.map((r) => [r.key, r.value]));
    expect(details).toMatchObject({ serial: 'FAKESERIAL000001', wan_ip: '192.0.2.10', hardware: 'CL-DEMO Ver.A', uptime: '3600' });
  });

  test('hide identifiers masks every one of them', () => {
    const text = JSON.stringify(buildDashboard(report, { hideIdentifiers: true }));
    for (const v of ['123456789012345', '001010123456789', '98000000000000000099', '+0000000001', '7654321', 'FAKESERIAL000001', '192.0.2.10', '2001:db8::10']) {
      expect(text).not.toContain(v);
    }
  });

  test('no service says so plainly', () => {
    const body = INFORMATION.replace('<workmode>LTE</workmode>', '<workmode>NO SERVICE</workmode>');
    const d = buildDashboard(importWebCapture(hilinkCapture({ responses: [answer('information', body), answer('signal', SIGNAL), answer('current-plmn', PLMN)] })));
    expect(d.network).toEqual({ word: 'No service', tone: 'bad' });
    expect(d.chips.find((c) => c.key === 'technology')?.value).toBe('LTE'); // from current-plmn
  });

  test('no service is never shown as a technology', () => {
    const body = INFORMATION.replace('<workmode>LTE</workmode>', '<workmode>NO SERVICE</workmode>');
    const d = buildDashboard(importWebCapture(hilinkCapture({ responses: [answer('information', body)] })));
    expect(d.chips.find((c) => c.key === 'technology')).toBeUndefined();
    expect(d.network?.word).toBe('No service');
  });

  test.each(['NO SERVICE', 'NO_SERVICE', 'No Service', 'NOSERVICE'])('%s counts as no service', (mode) => {
    const body = INFORMATION.replace('<workmode>LTE</workmode>', `<workmode>${mode}</workmode>`);
    const d = buildDashboard(importWebCapture(hilinkCapture({ responses: [answer('information', body)] })));
    expect(d.network).toEqual({ word: 'No service', tone: 'bad' });
    expect(d.chips.find((c) => c.key === 'technology')).toBeUndefined();
  });

  test('a scan report is not affected', () => {
    const d = buildDashboard({ startedAt: 'x', items: [], commandList: [] });
    expect(d.device).toEqual({});
    expect(d.network).toBeUndefined();
  });
});
