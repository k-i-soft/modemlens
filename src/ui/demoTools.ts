import { encodeSubmit } from '../tools/pdu';

const OK = 'OK';

/** The fake SIM and storage of the demo modem. Its codes are 1234 and 12345678, nothing real. */
export interface DemoTools {
  pin: string;
  puk: string;
  state: 'READY' | 'SIM PIN' | 'SIM PUK';
  lock: boolean;
  pinLeft: number;
  pukLeft: number;
  ctzu: string;
  copsMode: string;
  cmgf: string;
  sms: Map<number, { stat: number; pdu: string }>;
  ussdMenu: boolean;
  /** The URL the demo's HTTP client was given after AT+QHTTPURL. */
  httpUrl?: string;
}

/** Stored messages as received PDUs. Built from SUBMIT PDUs turned into DELIVER: same fake numbers and texts. */
function deliver(number: string, text: string, scts: string): string {
  const submit = encodeSubmit(number, text, 1)![0].hex;
  // 00 | first | MR | DA... -> 00 | 04 | OA... | PID | DCS | SCTS | UDL | UD
  const b = submit.slice(2);
  const daLen = parseInt(b.slice(4, 6), 16);
  const daEnd = 6 + 2 + Math.ceil(daLen / 2) * 2;
  const oa = b.slice(4, daEnd);
  const pidDcs = b.slice(daEnd, daEnd + 4);
  const rest = b.slice(daEnd + 4);
  return `0004${oa}${pidDcs}${scts}${rest}`;
}

export function createDemoTools(): DemoTools {
  return {
    pin: '1234',
    puk: '12345678',
    state: 'READY',
    lock: true,
    pinLeft: 3,
    pukLeft: 10,
    ctzu: '1',
    copsMode: '0',
    cmgf: '0',
    sms: new Map([
      [0, { stat: 1, pdu: deliver('+10000000001', 'Welcome to Demo Mobile. Your data plan is active.', '62112121430080') }],
      [1, { stat: 0, pdu: deliver('+10000000002', 'Your balance is 12.50. Grüezi from the demo €', '62112131054080') }],
    ]),
    ussdMenu: false,
  };
}

export type Later = (lines: string[], ms: number) => void;

/** Answers the commands of the tools, or undefined for every other command. */
export function toolAnswer(cmd: string, t: DemoTools, later: Later): string[] | undefined {
  const c = cmd.trim();
  if (/^AT\+CPIN\?$/i.test(c)) return [`+CPIN: ${t.state}`, OK];
  if (/^AT\+QPINC="SC"$/i.test(c)) return [`+QPINC: "SC",${t.pinLeft},${t.pukLeft}`, OK];
  if (/^AT\+CLCK="SC",2$/i.test(c)) return t.state === 'READY' ? [`+CLCK: ${t.lock ? 1 : 0}`, OK] : ['+CME ERROR: SIM PIN required'];

  const wrongPin = (): string[] => {
    t.pinLeft--;
    if (t.pinLeft <= 0) t.state = 'SIM PUK';
    return ['+CME ERROR: incorrect password'];
  };
  const unlock = /^AT\+CPIN="(\d+)"$/i.exec(c);
  if (unlock) {
    if (t.state !== 'SIM PIN') return ['+CME ERROR: operation not allowed'];
    if (unlock[1] !== t.pin) return wrongPin();
    t.state = 'READY';
    t.pinLeft = 3;
    return [OK];
  }
  const puk = /^AT\+CPIN="(\d+)","(\d+)"$/i.exec(c);
  if (puk) {
    if (t.state !== 'SIM PUK') return ['+CME ERROR: operation not allowed'];
    if (puk[1] !== t.puk) {
      t.pukLeft--;
      return ['+CME ERROR: incorrect password'];
    }
    t.pin = puk[2];
    t.state = 'READY';
    t.pinLeft = 3;
    t.pukLeft = 10;
    return [OK];
  }
  const change = /^AT\+CPWD="SC","(\d+)","(\d+)"$/i.exec(c);
  if (change) {
    if (!t.lock) return ['+CME ERROR: operation not allowed'];
    if (change[1] !== t.pin) return wrongPin();
    t.pin = change[2];
    t.pinLeft = 3;
    return [OK];
  }
  const lock = /^AT\+CLCK="SC",([01]),"(\d+)"$/i.exec(c);
  if (lock) {
    if (lock[2] !== t.pin) return wrongPin();
    t.lock = lock[1] === '1';
    t.pinLeft = 3;
    return [OK];
  }

  if (/^AT\+CTZU\?$/i.test(c)) return [`+CTZU: ${t.ctzu}`, OK];
  const ctzu = /^AT\+CTZU=([01])$/i.exec(c);
  if (ctzu) {
    t.ctzu = ctzu[1];
    return [OK];
  }

  if (/^AT\+CUSD=\?$/i.test(c)) return ['+CUSD: (0-2)', OK];
  if (/^AT\+CUSD=2$/i.test(c)) {
    t.ussdMenu = false;
    return [OK];
  }
  const ussd = /^AT\+CUSD=1,"([0-9*#]+)",15$/i.exec(c);
  if (ussd) {
    const code = ussd[1];
    if (t.ussdMenu) {
      t.ussdMenu = false;
      later([code === '1' ? '+CUSD: 0,"Your balance is 12.50.",15' : '+CUSD: 2'], 600);
    } else if (code === '*100#') {
      later(['+CUSD: 0,"Your balance is 12.50. Valid until 2026-12-31.",15'], 800);
    } else if (code === '*123#') {
      t.ussdMenu = true;
      later(['+CUSD: 1,"Demo menu', '1 Balance', '2 Exit",15'], 800);
    } else {
      later(['+CUSD: 4'], 500);
    }
    return [OK];
  }

  const select = /^AT\+COPS=([01])(?:,2,"(\d{5,6})"(?:,\d+)?)?$/i.exec(c);
  if (select) {
    if (select[1] === '1' && select[2] === '00103') return ['+CME ERROR: no network service'];
    t.copsMode = select[1];
    return [OK];
  }

  if (/^AT\+CMGF=\?$/i.test(c)) return ['+CMGF: (0-1)', OK];
  if (/^AT\+CMGF\?$/i.test(c)) return [`+CMGF: ${t.cmgf}`, OK];
  const cmgf = /^AT\+CMGF=([01])$/i.exec(c);
  if (cmgf) {
    t.cmgf = cmgf[1];
    return [OK];
  }
  if (/^AT\+CPMS\?$/i.test(c)) {
    const n = t.sms.size;
    return [`+CPMS: "SM",${n},20,"SM",${n},20,"SM",${n},20`, OK];
  }
  if (/^AT\+CMGL=4$/i.test(c)) {
    if (t.cmgf !== '0') return ['+CMS ERROR: 302'];
    const out: string[] = [];
    for (const [i, m] of [...t.sms.entries()].sort((a, b) => a[0] - b[0])) {
      out.push(`+CMGL: ${i},${m.stat},,${m.pdu.length / 2 - 1}`, m.pdu);
      if (m.stat === 0) m.stat = 1;
    }
    return [...out, OK];
  }
  const del = /^AT\+CMGD=(\d+)$/i.exec(c);
  if (del) {
    t.sms.delete(Number(del[1]));
    return [OK];
  }

  // The modem's own HTTP client: about 18 Mbit/s into a file, which is deleted afterwards.
  if (/^AT\+QHTTPURL=\?$/i.test(c)) return ['+QHTTPURL: (1-2048),(1-65535)', OK];
  if (/^AT\+QFLDS="UFS"$/i.test(c)) return ['+QFLDS: 6291456,12582912', OK];
  if (/^AT\+QHTTPCFG="(contextid|responseheader)",\d$/i.test(c)) return [OK];
  const httpGet = /^AT\+QHTTPGET=\d+$/i.test(c);
  if (httpGet) {
    const bytes = Number(/bytes=(\d+)/.exec(t.httpUrl ?? '')?.[1] ?? 0);
    later([`+QHTTPGET: 0,200,${bytes}`], 200);
    return [OK];
  }
  if (/^AT\+QHTTPREADFILE="UFS:[a-z.]+",\d+$/i.test(c)) {
    const bytes = Number(/bytes=(\d+)/.exec(t.httpUrl ?? '')?.[1] ?? 0);
    later(['+QHTTPREADFILE: 0'], 100 + (bytes * 8) / 18000);
    return [OK];
  }
  if (/^AT\+QFDEL="UFS:[a-z.]+"$/i.test(c)) return [OK];
  if (/^AT\+QPING=\?$/i.test(c)) return ['+QPING: (1-16),<host>,(1-255),(1-10)', OK];
  const ping = /^AT\+QPING=1,"([^"]+)",(\d+),(\d+)$/i.exec(c);
  if (ping) {
    const host = ping[1] === '8.8.8.8' || ping[1] === '1.1.1.1' ? ping[1] : '10.0.0.9';
    const times = [38, 42, 35, 47].slice(0, Number(ping[3]));
    times.forEach((ms, i) => later([`+QPING: 0,"${host}",32,${ms},255`], 300 * (i + 1)));
    later([`+QPING: 0,${times.length},${times.length},0,35,47,${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}`], 300 * times.length + 100);
    return [OK];
  }
  return undefined;
}

/** After AT+CMGS the demo modem takes the PDU and answers with a message reference. */
export function cmgsLength(cmd: string): number | undefined {
  const m = /^AT\+CMGS=(\d+)$/i.exec(cmd.trim());
  return m ? Number(m[1]) : undefined;
}

let reference = 0;

export function acceptSubmit(t: DemoTools, body: string, length: number): string[] {
  if (t.cmgf !== '0' || !/^(?:[0-9A-Fa-f]{2})+$/.test(body) || body.length / 2 - 1 !== length) return ['+CMS ERROR: 304'];
  reference = (reference + 1) % 256;
  return [`+CMGS: ${reference}`, OK];
}


/** A stand-in for the speed test servers: about 24 Mbit/s down, 9 up, 28 ms, from a documentation AS. */
export function createDemoSpeedEnv(): { fetch: typeof fetch; now: () => number } {
  const sleep = (ms: number, signal?: AbortSignal | null) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
    });
  const demoFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const signal = init?.signal;
    if (url.hostname === 'stat.ripe.net') {
      await sleep(120, signal);
      return new Response(JSON.stringify({ data: { holder: 'DEMO-MOBILE Demo Mobile Ltd' } }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/__up') {
      const size = init?.body instanceof Uint8Array ? init.body.byteLength : 0;
      await sleep(28 + (size * 8) / 9000, signal);
      return new Response('', { status: 200 });
    }
    const bytes = Math.min(Number(url.searchParams.get('bytes') ?? 0), 50_000_000);
    await sleep(28 + 3 * Math.random() + (bytes * 8) / 24000, signal);
    return new Response(new Uint8Array(bytes), { headers: { 'cf-meta-asn': '64496', 'cf-meta-country': 'XX' } });
  };
  return { fetch: demoFetch as typeof fetch, now: () => performance.now() };
}

/** After AT+QHTTPURL the demo modem answers CONNECT and takes the URL as it comes. */
export function qhttpUrlLength(cmd: string): number | undefined {
  const m = /^AT\+QHTTPURL=(\d+),\d+$/i.exec(cmd.trim());
  return m ? Number(m[1]) : undefined;
}
