import { describe, expect, test } from 'vitest';
import { COUNTER_READ, COUNTER_RESET, formatBytes, rates, readCounter, resetCounter, routedThroughModem } from '../../src/tools/traffic';
import { fakeIo } from './fakeIo';

describe('modem data counter', () => {
  test('reads sent and received bytes, in the order the EC200A gives them', async () => {
    // Measured on an EC200A: during a 1 MB download the second number grew by 1 044 149.
    const { io } = fakeIo({ [COUNTER_READ]: { lines: ['+QGDCNT: 366856,5914602'] } });
    expect(await readCounter(io)).toEqual({ sent: 366856, received: 5914602 });
  });

  test('a refusal or a garbled answer is no counter', async () => {
    expect(await readCounter(fakeIo({}).io)).toBeNull();
    expect(await readCounter(fakeIo({ [COUNTER_READ]: { lines: ['+QGDCNT: x,y'] } }).io)).toBeNull();
  });

  test('rates come from the difference between two readings', () => {
    const r = rates([
      { at: 0, sent: 1000, received: 10_000 },
      { at: 1000, sent: 3500, received: 260_000 },
      { at: 3000, sent: 3500, received: 260_000 },
    ]);
    expect(r).toEqual([
      { at: 1000, downMbps: 2, upMbps: 0.02 },
      { at: 3000, downMbps: 0, upMbps: 0 },
    ]);
  });

  test('a counter that went back, after a reset, is no negative speed', () => {
    const r = rates([
      { at: 0, sent: 5000, received: 900_000 },
      { at: 1000, sent: 0, received: 125_000 },
      { at: 2000, sent: 0, received: 250_000 },
    ]);
    expect(r).toEqual([{ at: 2000, downMbps: 1, upMbps: 0 }]);
  });

  test.each([
    [0, '0 B'],
    [999, '999 B'],
    [1500, '1.5 kB'],
    [344_962, '345 kB'],
    [5_914_602, '5.9 MB'],
    [123_456_789, '123 MB'],
    [4_870_453_000, '4.87 GB'],
  ])('%d bytes read as %s', (n, s) => {
    expect(formatBytes(n)).toBe(s);
  });

  test.each([
    // The test downloaded 6.1 MB.
    [6_100_000, 6_350_000, true],
    [6_100_000, 4_000, false],
    [6_100_000, 3_000_000, undefined],
    // Too little to say anything.
    [200_000, 0, undefined],
  ] as const)('a test of %d bytes with %d counted by the modem: through the modem %s', (test, counted, expected) => {
    expect(routedThroughModem(test, counted)).toBe(expected);
  });

  test('reset sends the one write and reads the counter back', async () => {
    const { io, commands } = fakeIo({
      [COUNTER_RESET]: {},
      [COUNTER_READ]: { lines: ['+QGDCNT: 0,0'] },
    });
    const out = await resetCounter(io);
    expect(commands()).toEqual([COUNTER_RESET, COUNTER_READ]);
    expect(out.tone).toBe('ok');
    expect(out.counter).toEqual({ sent: 0, received: 0 });
  });

  test('a reset the modem refuses says so', async () => {
    const out = await resetCounter(fakeIo({ [COUNTER_RESET]: { status: 'error', errorDetail: '+CME ERROR: 3' } }).io);
    expect(out.tone).toBe('bad');
    expect(out.message).toContain('refused');
  });

  test('a reset that the read-back does not show is a warning, not a success', async () => {
    const out = await resetCounter(fakeIo({ [COUNTER_RESET]: {}, [COUNTER_READ]: { lines: ['+QGDCNT: 366856,5914602'] } }).io);
    expect(out.tone).toBe('warn');
  });
});
