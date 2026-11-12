import { describe, expect, test } from 'vitest';
import { alphabetOf, decodePdu, encodeSubmit, parseSmsList, planSubmit, toSeptets } from '../../src/tools/pdu';

// Built outside this code, with an independent packer: the fake number +41791234567, 2026-11-20 12:34:00 +02:00.
const UCS2 = '00040B911497214365F70008621102214300801000470072' + '00FC0065007A0069002020AC';
const PART1 = '00440B911497214365F70008621102214300801A0500032A0201005400650069006C002000650069006E00730020';
const PART2 = '00440B911497214365F7000862110221430080180500032A0202005400650069006C0020007A007700650069';
const ALPHA = '000408D0C472FB0D00006211022143008010C337B90C8AC96634D086F75E6F7C';
// The classic SMS-DELIVER example: "hellohello" from 27838890001.
const CLASSIC = '07917283010010F5040BC87238880900F10000993092516195800AE8329BFD4697D9EC37';

describe('decoding stored messages', () => {
  test('UCS2 text with umlaut and euro sign', () => {
    expect(decodePdu(UCS2)).toEqual({ kind: 'received', number: '+41791234567', time: '2026-11-20 12:34:00 +02:00', text: 'Grüezi €', concat: undefined });
  });

  test('an alphanumeric sender and GSM 7-bit with extension characters', () => {
    const p = decodePdu(ALPHA)!;
    expect(p.number).toBe('Demo');
    expect(p.text).toBe('Code 1234 [ok]');
  });

  test('the classic example', () => {
    const p = decodePdu(CLASSIC)!;
    expect(p.text).toBe('hellohello');
    expect(p.number).toBe('27838890001');
    expect(p.time).toBe('1999-03-29 15:16:59 +02:00');
  });

  test('parts carry their place in the longer message', () => {
    expect(decodePdu(PART2)!.concat).toEqual({ ref: 0x2a, total: 2, seq: 2 });
  });

  test.each(['', 'zz', '0', '00', '0004', '00040B91149721'])('%j is no message', (hex) => {
    expect(decodePdu(hex)).toBeNull();
  });
});

describe('the list', () => {
  test('pairs headers with PDUs and joins parts in order, whatever order they are stored in', () => {
    const list = parseSmsList(['+CMGL: 3,1,,37', PART2, '+CMGL: 1,0,,30', UCS2, '+CMGL: 2,1,,40', PART1]);
    expect(list.map((m) => [m.indexes, m.status, m.text, m.incomplete])).toEqual([
      [[1], 'unread', 'Grüezi €', false],
      [[2, 3], 'read', 'Teil eins Teil zwei', false],
    ]);
  });

  test('a missing part is marked', () => {
    expect(parseSmsList(['+CMGL: 2,1,,40', PART1])[0].incomplete).toBe(true);
  });

  test('an empty storage is an empty list', () => expect(parseSmsList([])).toEqual([]));
});

describe('alphabets', () => {
  test.each([[0x00, 'gsm7'], [0x08, 'ucs2'], [0x04, '8bit'], [0xf0, 'gsm7'], [0xf4, '8bit'], [0xe0, 'ucs2'], [0x18, 'ucs2']])('DCS %i is %s', (dcs, a) => {
    expect(alphabetOf(dcs)).toBe(a);
  });

  test('extension characters take two septets, missing ones make it UCS2', () => {
    expect(toSeptets('€')).toHaveLength(2);
    expect(toSeptets('ő')).toBeNull();
  });
});

describe('sending', () => {
  test.each([
    ['a'.repeat(160), 'gsm7', 1],
    ['a'.repeat(161), 'gsm7', 2],
    ['a'.repeat(306), 'gsm7', 2],
    ['a'.repeat(307), 'gsm7', 3],
    ['ő'.repeat(70), 'ucs2', 1],
    ['ő'.repeat(71), 'ucs2', 2],
  ])('%#: plan', (text, alphabet, parts) => {
    expect(planSubmit(text)).toMatchObject({ alphabet, parts });
  });

  test('a single GSM part', () => {
    expect(encodeSubmit('+41791234567', 'hellohello', 0)).toEqual([
      { length: 22, hex: '0001000B911497214365F700000AE8329BFD4697D9EC37' },
    ]);
  });

  test('every encoded text reads back the same', () => {
    for (const text of ['Grüezi €', 'Szia, hogy vagy? ő ű', 'x'.repeat(400), '[{}]~|^\\ '.repeat(30), 'ő'.repeat(150)]) {
      const pdus = encodeSubmit('0791234567', text, 7)!;
      const parts = pdus.map((p, i) => [`+CMGL: ${i},3,,${p.length}`, p.hex]).flat();
      const list = parseSmsList(parts);
      expect(list, text).toHaveLength(1);
      expect(list[0]).toMatchObject({ kind: 'sent', number: '0791234567', text, incomplete: false });
      for (const p of pdus) expect(p.hex.length / 2 - 1).toBe(p.length);
    }
  });

  test.each([
    ['letters in the number', '+41ab', 'x'],
    ['too short', '12', 'x'],
    ['quote', '123"', 'x'],
    ['empty text', '+41791234567', ''],
    ['too long', '+41791234567', 'x'.repeat(153 * 6 + 1)],
  ])('%s: nothing to send', (_name, number, text) => {
    expect(encodeSubmit(number, text, 0)).toBeNull();
  });
});
