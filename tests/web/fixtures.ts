/** Obviously fake answers in the shape a HiLink stick gives. Nothing here belongs to a real device or SIM. */
export const INFORMATION = `<?xml version="1.0" encoding="UTF-8"?>
<response>
<DeviceName>DEMO-STICK-1</DeviceName>
<SerialNumber>FAKESERIAL000001</SerialNumber>
<Imei>123456789012345</Imei>
<Imsi>001010123456789</Imsi>
<Iccid>98000000000000000099</Iccid>
<Msisdn>+0000000001</Msisdn>
<HardwareVersion>CL-DEMO Ver.A</HardwareVersion>
<SoftwareVersion>DEMOFW&#40;FAKE&#41;</SoftwareVersion>
<WebUIVersion>WEBUI-DEMO</WebUIVersion>
<MacAddress1>00:00:5E:00:53:01</MacAddress1>
<MacAddress2>00:00:5E:00:53:02</MacAddress2>
<WanIPAddress>192.0.2.10</WanIPAddress>
<WanIPv6Address>2001:db8::10</WanIPv6Address>
<wan_dns_address>192.0.2.53</wan_dns_address>
<wan_ipv6_dns_address>2001:db8::53</wan_ipv6_dns_address>
<ProductFamily>LTE</ProductFamily>
<Classify>hilink</Classify>
<supportmode>LTE|WCDMA</supportmode>
<workmode>LTE</workmode>
<Mccmnc>00101</Mccmnc>
<uptime>3600</uptime>
<Empty></Empty>
</response>`;

export const SIGNAL = `<?xml version="1.0" encoding="UTF-8"?>
<response>
<pci>201</pci>
<cell_id>7654321</cell_id>
<tac>4321</tac>
<lac></lac>
<enodeb_id>29900</enodeb_id>
<nei_cellid>No1:202No2:203</nei_cellid>
<band>3</band>
<plmn>00101</plmn>
<mode>7</mode>
<rsrp>-86dBm</rsrp>
<rsrq>-5.0dB</rsrq>
<rssi>-63dBm</rssi>
<sinr>20dB</sinr>
<dlbandwidth>20MHz</dlbandwidth>
<ulbandwidth>10MHz</ulbandwidth>
<earfcn>DL:1850 UL:19850</earfcn>
<dlfrequency>1870000kHz</dlfrequency>
<ulfrequency>1775000kHz</ulfrequency>
</response>`;

export const PLMN = `<?xml version="1.0" encoding="UTF-8"?>
<response>
<State>0</State>
<FullName>Demo Mobile</FullName>
<ShortName>Demo</ShortName>
<Numeric>00101</Numeric>
<Rat>7</Rat>
<Spn></Spn>
</response>`;

export const IDENTIFIERS = [
  'FAKESERIAL000001', '123456789012345', '001010123456789', '98000000000000000099', '+0000000001',
  '00:00:5E:00:53:01', '00:00:5E:00:53:02', '192.0.2.10', '2001:db8::10', '192.0.2.53', '2001:db8::53',
  '7654321', '4321', '29900', 'No1:202No2:203',
];

export function hilinkCapture(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'modemlens-web-capture',
    version: 1,
    dialect: 'hilink',
    capturedAt: '2026-01-02T03:04:05.000Z',
    responses: [
      { id: 'information', status: 200, body: INFORMATION },
      { id: 'signal', status: 200, body: SIGNAL },
      { id: 'current-plmn', status: 200, body: PLMN },
    ],
    ...overrides,
  });
}
