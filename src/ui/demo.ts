import type { Transport } from '../transport/types';

/** USB id the demo modem claims. */
export const DEMO_USB = '2c7c:6005';

const OK = 'OK';
const ERR = 'ERROR';

/** Obviously fake identity and identifiers. Nothing here belongs to a real device or SIM. */
const ANSWERS: Record<string, string[]> = {
  'AT': [OK],
  'ATI': ['DEMO Modem Co.', 'EC200A', 'Revision: EC200ADEMOFAKE01', OK],
  'AT+GMI': ['DEMO Modem Co.', OK],
  'AT+CGMI': ['DEMO Modem Co.', OK],
  'AT+GMM': ['EC200A', OK],
  'AT+CGMM': ['EC200A', OK],
  'AT+GMR': ['EC200ADEMOFAKE01', OK],
  'AT+CGMR': ['EC200ADEMOFAKE01', OK],
  'AT+CGSN': ['123456789012345', OK],
  'AT+GSN': ['123456789012345', OK],
  'AT+CPIN?': ['+CPIN: READY', OK],
  'AT+CIMI': ['001010123456789', OK],
  'AT+CRSM=176,12258,0,0,10': ['+CRSM: 144,0,"98000000000000000099"', OK],
  'AT+CLCK="SC",2': ['+CLCK: 0', OK],
  'AT+CLCK="PN",2': [ERR],
  'AT+CLCK="PU",2': [ERR],
  'AT+CLCK="PP",2': [ERR],
  'AT+CLCK="PS",2': [ERR],
  'AT+CLCK="PF",2': [ERR],
  'AT+COPS?': ['+COPS: 0,0,"Demo Mobile",7', OK],
  'AT+CREG?': ['+CREG: 0,1', OK],
  'AT+CGREG?': ['+CGREG: 0,1', OK],
  'AT+CEREG?': ['+CEREG: 0,1', OK],
  'AT+C5GREG?': [ERR],
  'AT+CSQ': ['+CSQ: 21,99', OK],
  'AT+CESQ': ['+CESQ: 99,99,255,255,20,60', OK],
  'AT+CGDCONT?': ['+CGDCONT: 1,"IP","demo.apn","10.0.0.2",0,0', OK],
  'AT+CGACT?': ['+CGACT: 1,1', OK],
  'AT+CGATT?': ['+CGATT: 1', OK],
  'AT+CGPADDR': ['+CGPADDR: 1,"10.0.0.2"', OK],
  'AT+CLCC=?': [OK],
  'AT+CLVL?': ['+CLVL: 3', OK],
  'AT+CRSL?': ['+CRSL: 3', OK],
  'AT+CALM?': ['+CALM: 0', OK],
  'AT+CLIP?': ['+CLIP: 0,1', OK],
  'AT+CFUN?': ['+CFUN: 1', OK],
  'AT+CMEE?': ['+CMEE: 0', OK],
  'AT+CSCS?': ['+CSCS: "GSM"', OK],
  'AT+CCLK?': ['+CCLK: "26/01/01,12:00:00+04"', OK],
  'AT+CTZU?': ['+CTZU: 0', OK],
  'AT+CSCA?': ['+CSCA: "+0000000000",145', OK],
  'AT+QCCID': ['+QCCID: 98000000000000000099', OK],
  'AT+QSPN': ['+QSPN: "Demo Mobile","Demo","",0,"00101"', OK],
  'AT+QNWINFO': ['+QNWINFO: "FDD LTE","00101","LTE BAND 3",1300', OK],
  'AT+QCSQ': ['+QCSQ: "LTE",-62,-92,150,-10', OK],
  'AT+QTEMP': ['+QTEMP: 38,38,38', OK],
  'AT+COPS=?': ['+COPS: (2,"Demo Mobile","Demo","00101",7),(1,"Other Demo","Other","00102",7),,(0-4),(0-2)', OK],
  'AT+CLAC': ['AT+CGMI', 'AT+CSQ', 'AT+QDEMOFAKE', 'AT+QDEMOINFO', OK],
  'AT+QDEMOFAKE=?': ['+QDEMOFAKE: (0,1)', OK],
  'AT+QDEMOFAKE?': ['+QDEMOFAKE: 0', OK],
  'AT+QDEMOINFO=?': [OK],
  'AT+QDEMOINFO?': [ERR],
};

export interface DemoTransport extends Transport {
  /** Simulates a pulled cable. */
  disconnect(reason?: string): void;
}

/** A scripted, in-page modem for `?demo=1`. It answers every command in the catalog and a few extras. */
export function createDemoTransport(opts: { delayMs?: number } = {}): DemoTransport {
  const delayMs = opts.delayMs ?? 60;
  let dataCbs: Array<(c: Uint8Array) => void> = [];
  let discCbs: Array<(r: string) => void> = [];
  let closed = false;
  let pending = '';

  const emit = (text: string): void => {
    if (closed) return;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    for (const cb of dataCbs) cb(bytes);
  };

  const answer = (cmd: string): void => {
    const lines = ANSWERS[cmd.toUpperCase()] ?? [ERR];
    emit(`\r\n${lines.join('\r\n')}\r\n`);
  };

  return {
    kind: 'fake',
    label: 'Demo modem (fake, nothing connected)',
    async write(data) {
      if (closed) throw new Error('transport closed');
      pending += String.fromCharCode(...data);
      let idx: number;
      while ((idx = pending.search(/[\r\n]/)) >= 0) {
        const cmd = pending.slice(0, idx).trim();
        pending = pending.slice(idx + 1);
        if (!cmd) continue;
        if (delayMs > 0) setTimeout(() => answer(cmd), delayMs);
        else queueMicrotask(() => answer(cmd));
      }
    },
    onData(cb) { dataCbs.push(cb); },
    onDisconnect(cb) { discCbs.push(cb); },
    async close() { closed = true; },
    disconnect(reason = 'Demo cable pulled') {
      closed = true;
      for (const cb of discCbs) cb(reason);
    },
  };
}
