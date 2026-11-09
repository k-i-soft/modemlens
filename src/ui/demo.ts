import type { Transport, UsbDeviceDescription } from '../transport/types';
import { NoAtChannelError } from '../transport/webUsb';
import { classifyUsbDevice } from '../profiles/known-devices';

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
  'AT+CGACT?': ['+CGACT: 1,1', '+CGACT: 2,0', OK],
  'AT+CGATT?': ['+CGATT: 1', OK],
  'AT+CGPADDR': ['+CGPADDR: 1,"10.0.0.2"', '+CGPADDR: 2,"0.0.0.0"', OK],
  'AT+CLCC=?': [OK],
  'AT+CLVL?': ['+CLVL: 3', OK],
  'AT+CRSL?': ['+CRSL: 3', OK],
  'AT+CALM?': ['+CALM: 0', OK],
  'AT+CLIP?': ['+CLIP: 0,1', OK],
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
  'AT+QENG="SERVINGCELL"': ['+QENG: "servingcell","NOCONN","LTE","FDD",001,01,DEC0DE,123,1300,3,5,5,FACE,-85,-9,-60,16,20,5', OK],
  'AT+QENG="NEIGHBOURCELL"': [
    '+QENG: "neighbourcell intra","LTE",1300,201,-8,-78,-55,14,0,0,0,0',
    '+QENG: "neighbourcell intra","LTE",1300,202,-11,-93,-68,9,0,0,0,0',
    '+QENG: "neighbourcell inter","LTE",6300,301,-14,-99,-72,4,0,0,0,0',
    '+QENG: "neighbourcell inter","LTE",3350,302,-19,-112,-85,-3,0,0,0,0',
    OK,
  ],
  'AT+QCFG="BAND"': ['+QCFG: "band",0x3,0x80800C5', OK],
  'AT+QPINC?': ['+QPINC: "SC",2,10', '+QPINC: "P2",3,10', OK],
  'AT+QGMR': ['EC200ADEMOFAKE01_BUILD', OK],
  'AT+COPS=?': ['+COPS: (2,"Demo Mobile","Demo","00101",7),(1,"Other Demo","Other","00102",7),(3,"Barred Demo","Barred","00103",2),,(0-4),(0-2)', OK],
  'AT+CLAC': ['AT+CGMI', 'AT+CSQ', 'AT+QDEMOFAKE', 'AT+QDEMOINFO', OK],
  'AT+QDEMOFAKE=?': ['+QDEMOFAKE: (0,1)', OK],
  'AT+QDEMOFAKE?': ['+QDEMOFAKE: 0', OK],
  'AT+QDEMOINFO=?': [OK],
  'AT+QDEMOINFO?': [ERR],
};

/** A reading that drifts slowly, so that the live view has something to draw. */
function demoCesq(now: number): string[] {
  const rsrp = -85 + 8 * Math.sin(now / 17000) + 2 * Math.sin(now / 3100);
  const rsrq = -10 + 2 * Math.sin(now / 11000);
  return [`+CESQ: 99,99,255,255,${Math.round((rsrq + 20) * 2)},${Math.round(rsrp + 141)}`, OK];
}

/** The settings of the demo modem. Keep one object across connections and it survives a restart. */
export interface DemoSettings {
  pdpType: string;
  apn: string;
  data: boolean;
  radio: string;
  qcfg: Record<'usbnet' | 'nat' | 'nwscanmode' | 'roamservice', string>;
}

export function createDemoSettings(): DemoSettings {
  return { pdpType: 'IP', apn: 'demo.apn', data: false, radio: '1', qcfg: { usbnet: '1', nat: '0', nwscanmode: '0', roamservice: '2' } };
}

const qcfgLine = (name: string, value: string): string =>
  `+QCFG: "${name}",${value}${name === 'roamservice' ? ',1' : ''}`;

/** Answers a command that reads or changes a setting, or undefined for every other command. */
function settingsAnswer(cmd: string, s: DemoSettings, restart: () => void): string[] | undefined {
  if (/^AT\+CGDCONT\?$/i.test(cmd)) {
    return [`+CGDCONT: 1,"${s.pdpType}","${s.apn}","10.0.0.2",0,0`, '+CGDCONT: 2,"IPV4V6","ims.demo","0.0.0.0",0,0', OK];
  }
  const apn = /^AT\+CGDCONT=1,"([A-Z0-9]+)","([^"]*)"$/i.exec(cmd);
  if (apn) {
    s.pdpType = apn[1].toUpperCase();
    s.apn = apn[2];
    return [OK];
  }
  if (/^AT\+QNETDEVCTL\?$/i.test(cmd)) {
    const d = s.data ? 1 : 0;
    return [`+QNETDEVCTL: ${d},${d},${d},${d}`, OK];
  }
  const data = /^AT\+QNETDEVCTL=([01]),1,1$/i.exec(cmd);
  if (data) {
    if (s.radio !== '1') return [ERR];
    s.data = data[1] === '1';
    return [OK, `+QNETDEVSTATUS: ${data[1]}`];
  }
  if (/^AT\+CFUN\?$/i.test(cmd)) return [`+CFUN: ${s.radio}`, OK];
  if (/^AT\+CFUN=1,1$/i.test(cmd)) {
    s.radio = '1';
    s.data = false;
    restart();
    return [OK];
  }
  const radio = /^AT\+CFUN=([14])$/i.exec(cmd);
  if (radio) {
    s.radio = radio[1];
    if (s.radio !== '1') s.data = false;
    return [OK];
  }
  const qcfg = /^AT\+QCFG="(usbnet|nat|nwscanmode|roamservice)"(?:,(\d)(?:,1)?)?$/i.exec(cmd);
  if (qcfg) {
    const name = qcfg[1].toLowerCase() as keyof DemoSettings['qcfg'];
    if (qcfg[2] === undefined) return [qcfgLine(name, s.qcfg[name]), OK];
    s.qcfg[name] = qcfg[2];
    return [OK];
  }
  return undefined;
}

/** What a modem with its radio off answers instead of its usual network status. */
const RADIO_OFF_ANSWERS: Record<string, string[]> = {
  'AT+CREG?': ['+CREG: 0,0', OK],
  'AT+CGREG?': ['+CGREG: 0,0', OK],
  'AT+CEREG?': ['+CEREG: 0,0', OK],
  'AT+COPS?': ['+COPS: 0', OK],
  'AT+CSQ': ['+CSQ: 99,99', OK],
  'AT+CESQ': ['+CESQ: 99,99,255,255,255,255', OK],
  'AT+CGATT?': ['+CGATT: 0', OK],
  'AT+CGACT?': ['+CGACT: 1,0', '+CGACT: 2,0', OK],
  'AT+CGPADDR': ['+CGPADDR: 1,"0.0.0.0"', '+CGPADDR: 2,"0.0.0.0"', OK],
  'AT+QNWINFO': ['+QNWINFO: No Service', OK],
  'AT+QCSQ': ['+QCSQ: "NOSERVICE"', OK],
  'AT+QENG="SERVINGCELL"': ['+QENG: "servingcell","SEARCH"', OK],
};

/** How long the simulated modem keeps talking before a restart takes it away. */
const DEMO_RESTART_MS = 150;

export interface DemoTransport extends Transport {
  /** Simulates a pulled cable. */
  disconnect(reason?: string): void;
}

/** A scripted, in-page modem for `?demo=1`. It answers every command in the catalog and a few extras. */
export function createDemoTransport(opts: { delayMs?: number; settings?: DemoSettings } = {}): DemoTransport {
  const delayMs = opts.delayMs ?? 60;
  const settings = opts.settings ?? createDemoSettings();
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
    const name = cmd.toUpperCase();
    const radioOff = settings.radio === '1' ? undefined : RADIO_OFF_ANSWERS[name];
    const lines = settingsAnswer(cmd, settings, restart) ?? radioOff ?? (name === 'AT+CESQ' ? demoCesq(Date.now()) : ANSWERS[name] ?? [ERR]);
    emit(`\r\n${lines.join('\r\n')}\r\n`);
  };

  const self: DemoTransport = {
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
      if (closed) return;
      closed = true;
      for (const cb of discCbs) cb(reason);
    },
  };
  const restart = (): void => void setTimeout(() => self.disconnect('Demo modem restarting'), DEMO_RESTART_MS);
  return self;
}

/** A HiLink stick for `?demo=web`: the same guidance a real one gets, under a made-up product name. */
export function demoHiLinkError(): NoAtChannelError {
  const device: UsbDeviceDescription = {
    usb: '12d1:14db',
    productName: 'Demo stick (fake)',
    interfaces: [
      { number: 0, class: 0x02, subclass: 0x06 },
      { number: 1, class: 0x0a, subclass: 0x00 },
    ],
  };
  const classification = classifyUsbDevice({ usb: device.usb, interfaceClasses: device.interfaces.map((i) => i.class) });
  return new NoAtChannelError('This device has no AT channel.', false, classification, device);
}

const xmlResponse = (tags: Record<string, string>): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<response>\n${Object.entries(tags).map(([k, v]) => `<${k}>${v}</${k}>`).join('\n')}\n</response>`;

/** A capture file as the bookmarklet would save it for `?demo=web`, with obviously fake identifiers. */
export function demoWebCapture(): string {
  const information = xmlResponse({
    DeviceName: 'DEMO-HiLink', SerialNumber: 'DEMOFAKESERIAL01', Imei: '123456789012345', Imsi: '001010123456789',
    Iccid: '98000000000000000099', Msisdn: '+0000000000', HardwareVersion: 'DEMO-HW-1', SoftwareVersion: 'DEMO-FW&#40;FAKE&#41;',
    WebUIVersion: 'DEMO-UI', MacAddress1: '00:00:5E:00:53:01', MacAddress2: '', WanIPAddress: '192.0.2.10', WanIPv6Address: '2001:db8::10',
    wan_dns_address: '192.0.2.53', wan_ipv6_dns_address: '', ProductFamily: 'LTE', Classify: 'hilink', supportmode: 'LTE|WCDMA|GSM',
    workmode: 'LTE', Mccmnc: '00101', uptime: '3600',
  });
  const signal = xmlResponse({
    pci: '201', cell_id: '7654321', tac: '4321', lac: '', enodeb_id: '29900', nei_cellid: '', band: '3', plmn: '00101', mode: '7',
    rsrp: '-86dBm', rsrq: '-5.0dB', rssi: '-63dBm', sinr: '20dB', dlbandwidth: '20MHz', ulbandwidth: '20MHz',
    earfcn: 'DL:1300 UL:19300', dlfrequency: '1815000kHz', ulfrequency: '1720000kHz',
  });
  const plmn = xmlResponse({ State: '0', FullName: 'Demo Mobile', ShortName: 'Demo', Numeric: '00101', Rat: '7', Spn: '' });
  return JSON.stringify({
    format: 'modemlens-web-capture',
    version: 1,
    dialect: 'hilink',
    capturedAt: '2026-01-01T12:00:00.000Z',
    responses: [
      { id: 'information', status: 200, body: information },
      { id: 'signal', status: 200, body: signal },
      { id: 'current-plmn', status: 200, body: plmn },
    ],
  });
}

/** A made-up stick for `?demo=noat`: it only offers network and storage interfaces, as a modem without AT does. */
export function demoNoAtError(): NoAtChannelError {
  const device: UsbDeviceDescription = {
    usb: 'f00d:0001',
    productName: 'Demo stick (fake)',
    interfaces: [
      { number: 0, class: 0xe0, subclass: 0x01 },
      { number: 1, class: 0x0a, subclass: 0x00 },
      { number: 2, class: 0x08, subclass: 0x06 },
    ],
  };
  const classification = classifyUsbDevice({ usb: device.usb, interfaceClasses: device.interfaces.map((i) => i.class) });
  return new NoAtChannelError('This device has no AT channel.', false, classification, device);
}
