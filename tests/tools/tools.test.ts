import { describe, expect, test } from 'vitest';
import { buildUssd, buildUssdReply, decodeUssdText, parseUssd, runUssd, ussdAccept } from '../../src/tools/ussd';
import { buildSelect, parseNetworks, scanNetworks, select, SELECT_AUTOMATIC } from '../../src/tools/operator';
import { buildPing, hostProblem, parseQuectel, parseSimcom, runPing } from '../../src/tools/ping';
import { deleteSms, listSms, parseStorage, sendSms } from '../../src/tools/sms';
import { probeTools, toolBlock, toolVerified } from '../../src/tools/support';
import { encodeSubmit } from '../../src/tools/pdu';
import { fakeIo } from './fakeIo';

const ok = (...lines: string[]) => ({ command: 'x', status: 'ok' as const, lines, durationMs: 1 });

describe('USSD', () => {
  test.each(['*100#', '#123#', '*123*1#', '*#06#'])('%s is a code', (c) => expect(buildUssd(c)).toBe(`AT+CUSD=1,"${c}",15`));
  test.each(['100#', '*100#"', '*10;0#', '', '*', '*1\r#', '*'.repeat(40)])('%j is not', (c) => expect(buildUssd(c)).toBeNull());
  test('a reply is digits', () => {
    expect(buildUssdReply('1')).toBe('AT+CUSD=1,"1",15');
    expect(buildUssdReply('a')).toBeNull();
  });

  test.each([
    ['plain text', 'Your balance is 5.00 CHF', 15, 'Your balance is 5.00 CHF'],
    ['UCS2 hex', '004700720075006500740069', 72, 'Grueti'],
    ['packed GSM hex of a Huawei', 'C8329BFD06', 15, 'Hello'],
    ['hex-looking text in GSM stays', '1234', 15, '1234'],
  ])('%s', (_n, raw, dcs, text) => {
    expect(decodeUssdText(raw, dcs)).toBe(text);
  });

  test('an answer over several lines, with commas and quotes inside', () => {
    expect(parseUssd(['+CUSD: 1,"Menu:', '1 Balance, "now"', '2 Top up",15'])).toEqual({ status: 1, text: 'Menu:\n1 Balance, "now"\n2 Top up' });
    expect(parseUssd(['+CUSD: 4'])).toEqual({ status: 4, text: '' });
    expect(parseUssd(['+CUSD: 1,"Menu:'])).toBeNull();
  });

  test('the listener takes the continuation lines too, and nothing after', () => {
    const accept = ussdAccept();
    expect(['RING', '+CUSD: 0,"a', 'b",15', 'RING'].map(accept)).toEqual([false, true, true, false]);
  });

  test('the answer arrives after the OK', async () => {
    const { io } = fakeIo({ 'AT+CUSD=1,"*100#",15': { after: ['+CUSD: 1,"1 Balance', '2 Exit",15'] } });
    const r = await runUssd(io, buildUssd('*100#')!);
    expect(r).toMatchObject({ tone: 'ok', open: true, text: '1 Balance\n2 Exit' });
  });

  test('the answer comes before the OK', async () => {
    const { io } = fakeIo({ 'AT+CUSD=1,"*100#",15': { lines: ['+CUSD: 0,"Balance 5",15'] } });
    expect(await runUssd(io, buildUssd('*100#')!)).toMatchObject({ tone: 'ok', open: false, text: 'Balance 5' });
  });

  test('a refusal', async () => {
    const { io } = fakeIo({ 'AT+CUSD=1,"*100#",15': { status: 'cme_error', errorDetail: 'unknown' } });
    expect(await runUssd(io, buildUssd('*100#')!)).toMatchObject({ tone: 'bad', open: false });
  });
});

describe('operator', () => {
  const SCAN = '+COPS: (2,"Demo Mobile","Demo","00101",7),(1,"Other, Net","Other","00102",0),(3,"","","00103",7),,(0,1,2,3,4),(0,1,2)';

  test('the list', () => {
    expect(parseNetworks(ok(SCAN))).toEqual([
      { status: 'current', name: 'Demo Mobile', plmn: '00101', act: '7', tech: 'LTE' },
      { status: 'available', name: 'Other, Net', plmn: '00102', act: '0', tech: 'GSM' },
      { status: 'forbidden', name: '00103', plmn: '00103', act: '7', tech: 'LTE' },
    ]);
  });

  test.each([
    ['00101', '7', 'AT+COPS=1,2,"00101",7'],
    ['001010', undefined, 'AT+COPS=1,2,"001010"'],
  ])('select %s %s', (plmn, act, command) => expect(buildSelect(plmn, act)).toBe(command));
  test.each([['0010', '7'], ['00101"', '7'], ['00101', '99'], ['00101', '7;']])('no select for %s %s', (plmn, act) => expect(buildSelect(plmn, act)).toBeNull());

  test('the scan has the long timeout', async () => {
    const { io, sent } = fakeIo({ 'AT+COPS=?': { lines: [SCAN] } });
    const r = await scanNetworks(io);
    expect(r.networks).toHaveLength(3);
    expect(sent[0].opts.timeoutMs).toBe(180000);
  });

  test('a selection counts once the mode reads back', async () => {
    const { io } = fakeIo({ 'AT+COPS=1,2,"00101",7': {}, 'AT+COPS?': { lines: ['+COPS: 1,0,"Demo Mobile",7'] } });
    expect((await select(io, buildSelect('00101', '7')!)).tone).toBe('ok');
    const back = fakeIo({ [SELECT_AUTOMATIC]: {}, 'AT+COPS?': { lines: ['+COPS: 1,0,"Demo Mobile",7'] } });
    expect((await select(back.io, SELECT_AUTOMATIC)).tone).toBe('warn');
  });
});

describe('ping', () => {
  test.each(['8.8.8.8', 'example.com', 'a-b.example.ch'])('%s is a host', (h) => expect(hostProblem(h)).toBeUndefined());
  test.each(['', 'localhost', '256.1.1.1', 'a"b.com', 'a.com;AT', '-a.com', 'a..com', '1.2.3'])('%j is not', (h) => expect(hostProblem(h)).toBeDefined());

  test('commands', () => {
    expect(buildPing('quectel', '8.8.8.8')).toBe('AT+QPING=1,"8.8.8.8",4,4');
    expect(buildPing('simcom', '1.1.1.1')).toBe('AT+SNPING4="1.1.1.1",4,16,4000');
    expect(buildPing('quectel', 'x"')).toBeNull();
  });

  test('Quectel answers after the OK', async () => {
    const { io } = fakeIo({
      'AT+QPING=1,"8.8.8.8",4,4': {
        after: ['+QPING: 0,"8.8.8.8",32,45,255', '+QPING: 569', '+QPING: 0,"8.8.8.8",32,51,255', '+QPING: 0,4,2,2,45,51,48'],
      },
    });
    const r = await runPing(io, 'quectel', '8.8.8.8');
    expect(r).toMatchObject({ tone: 'warn', times: [45, 51], replies: [45, null, 51, null], sent: 4, received: 2, ttl: 255 });
    expect(r.message).toContain('2 lost');
  });

  // A real EC200A, 2026-11-12: its summary line reports 0 as the shortest time, the replies say 10.
  test('a real EC200A run', () => {
    const p = parseQuectel(['+QPING: 0,"8.8.8.8",32,25,116', '+QPING: 0,"8.8.8.8",32,15,116', '+QPING: 0,"8.8.8.8",32,10,116', '+QPING: 0,"8.8.8.8",32,10,116', '+QPING: 0,4,4,0,0,25,15']);
    expect(p).toEqual({ times: [25, 15, 10, 10], replies: [25, 15, 10, 10], sent: 4, ttl: 116, error: undefined });
  });

  test('a Quectel ping that cannot start', () => {
    expect(parseQuectel(['+QPING: 561'])).toMatchObject({ times: [], replies: [null], sent: 4, error: '561' });
  });

  test('a full Quectel ping', async () => {
    const lines = ['+QPING: 0,"8.8.8.8",32,40,255', '+QPING: 0,"8.8.8.8",32,42,255', '+QPING: 0,"8.8.8.8",32,44,255', '+QPING: 0,"8.8.8.8",32,46,255', '+QPING: 0,4,4,0,40,46,43'];
    const { io } = fakeIo({ 'AT+QPING=1,"8.8.8.8",4,4': { after: lines } });
    const r = await runPing(io, 'quectel', '8.8.8.8');
    expect(r.tone).toBe('ok');
    expect(r.message).toBe('4 of 4 answered. Round trip 40 to 46 ms, 43 ms on average.');
  });

  test('SIMCom answers inline, a time past the timeout is lost', () => {
    expect(parseSimcom(['+SNPING4: 1,8.8.8.8,120', '+SNPING4: 2,8.8.8.8,60000', '+SNPING4: 3,8.8.8.8,98'])).toEqual([120, null, 98]);
  });

  test('a refused SIMCom ping points to Modem data', async () => {
    const { io } = fakeIo({ 'AT+SNPING4="8.8.8.8",4,16,4000': { status: 'error' } });
    expect((await runPing(io, 'simcom', '8.8.8.8')).message).toContain('Modem data');
  });
});

describe('SMS', () => {
  test('storage', () => {
    expect(parseStorage(ok('+CPMS: "SM",2,50,"SM",2,50,"SM",2,50'))).toEqual({ used: 2, total: 50 });
    expect(parseStorage(ok('+CPMS: 0'))).toBeNull();
  });

  test('the list is read in PDU mode and the text mode is put back', async () => {
    const pdu = encodeSubmit('0791234567', 'hello', 1)![0].hex;
    const { io, commands } = fakeIo({
      'AT+CPMS?': { lines: ['+CPMS: "SM",1,50,"SM",1,50,"SM",1,50'] },
      'AT+CMGF?': { lines: ['+CMGF: 1'] },
      'AT+CMGF=0': {},
      'AT+CMGL=4': { lines: ['+CMGL: 0,3,,18', pdu] },
      'AT+CMGF=1': {},
    });
    const r = await listSms(io);
    expect(r.messages.map((m) => m.text)).toEqual(['hello']);
    expect(r.storage).toEqual({ used: 1, total: 50 });
    expect(commands()).toEqual(['AT+CPMS?', 'AT+CMGF?', 'AT+CMGF=0', 'AT+CMGL=4', 'AT+CMGF=1']);
  });

  test('a long text goes out in parts, each with its PDU as the body', async () => {
    const text = 'x'.repeat(200);
    const pdus = encodeSubmit('+41791234567', text, 9)!;
    expect(pdus.map((p) => p.length)).toEqual([153, 61]);
    const { io, sent } = fakeIo({
      'AT+CMGF?': { lines: ['+CMGF: 0'] },
      'AT+CMGS=153': { lines: ['+CMGS: 1'] },
      'AT+CMGS=61': { lines: ['+CMGS: 2'] },
    });
    const r = await sendSms(io, '+41791234567', text, 9);
    expect(r.message).toBe('Sent in 2 parts.');
    expect(sent.filter((s) => s.command.startsWith('AT+CMGS')).map((s) => [s.command, s.opts.body])).toEqual(pdus.map((p) => [`AT+CMGS=${p.length}`, p.hex]));
  });

  test('a failed second part says that the first one went out', async () => {
    const pdus = encodeSubmit('+41791234567', 'x'.repeat(200), 9)!;
    const { io } = fakeIo({ 'AT+CMGF?': { lines: ['+CMGF: 0'] }, [`AT+CMGS=${pdus[0].length}`]: {}, [`AT+CMGS=${pdus[1].length}`]: { status: 'cms_error', errorDetail: '500' } });
    expect((await sendSms(io, '+41791234567', 'x'.repeat(200), 9)).message).toContain('1 of 2 parts went out before');
  });

  test('every part of a message is deleted', async () => {
    const { io, commands } = fakeIo({ 'AT+CMGD=2': {}, 'AT+CMGD=3': {} });
    expect((await deleteSms(io, [2, 3])).tone).toBe('ok');
    expect(commands()).toEqual(['AT+CMGD=2', 'AT+CMGD=3']);
    expect((await deleteSms(io, [1.5])).tone).toBe('bad');
  });
});

describe('support', () => {
  test('only what the modem answers, with read and test forms only', async () => {
    const { io, commands } = fakeIo({ 'AT+CPIN?': { lines: ['+CPIN: SIM PIN'] }, 'AT+CUSD=?': {}, 'AT+COPS?': { status: 'cme_error' }, 'AT+CMGF=?': {}, 'AT+QPING=?': {} });
    expect([...await probeTools(io, 'quectel-ec200a')].sort()).toEqual(['pin', 'ping', 'sms', 'ussd']);
    for (const c of commands()) expect(c).toMatch(/(\?|=\?)$/);
  });

  test('no ping without a known dialect', async () => {
    const { io, commands } = fakeIo({});
    await probeTools(io, 'huawei-k3715');
    expect(commands()).not.toContain('AT+QPING=?');
  });

  test('only the ping on the EC200A has run on real hardware', () => {
    expect(toolVerified('ping', 'quectel-ec200a')).toBe(true);
    for (const t of ['pin', 'ussd', 'operator', 'sms'] as const) expect(toolVerified(t, 'quectel-ec200a')).toBe(false);
    for (const t of ['pin', 'ussd', 'operator', 'sms', 'ping'] as const) expect(toolVerified(t, 'simcom-sim7000')).toBe(false);
  });

  test('blocks', () => {
    expect(toolBlock({ connected: true, imported: false, scanning: false })).toBeUndefined();
    expect(toolBlock({ connected: true, imported: false, scanning: true })).toContain('scan');
    expect(toolBlock({ connected: false, imported: true, scanning: false })).toContain('imported');
  });
});
