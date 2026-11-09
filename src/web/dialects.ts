export interface WebEndpoint {
  /** The name of this answer in a capture file. */
  id: string;
  /** Fixed and relative: the bookmarklet only ever asks the page it runs on. */
  path: string;
  parser: string;
}

export interface WebDialect {
  id: 'hilink' | 'zte';
  label: string;
  /** False until a capture from a real modem has confirmed the requests and the parser. */
  verified: boolean;
  endpoints: WebEndpoint[];
  /** Regular expression source a genuine answer matches, which tells the right page from the wrong tab. */
  answerPattern: string;
}

const ZTE_READ_VALUES = [
  'modem_model', 'model', 'cr_version', 'wa_inner_version', 'hw_version', 'imei', 'imsi', 'sim_imsi', 'iccid', 'ziccid', 'msisdn',
  'mac_address', 'wan_ipaddr', 'ipv6_wan_ipaddr', 'network_provider', 'network_type', 'lte_rsrp', 'lte_rsrq', 'lte_snr', 'Z_SINR',
  'rssi', 'cell_id', 'Z_CELL_ID', 'lac_code',
];

/** A new dialect is an entry here and a parser in parse/web.ts. Every path must be a read that needs no login. */
export const WEB_DIALECTS: WebDialect[] = [
  {
    id: 'hilink',
    label: 'Huawei HiLink stick',
    verified: true,
    answerPattern: '<response[ >]',
    endpoints: [
      { id: 'information', path: '/api/device/information', parser: 'hilink_information' },
      { id: 'signal', path: '/api/device/signal', parser: 'hilink_signal' },
      { id: 'current-plmn', path: '/api/net/current-plmn', parser: 'hilink_plmn' },
    ],
  },
  {
    id: 'zte',
    label: 'ZTE-style stick',
    verified: false,
    answerPattern: '^ *[{]',
    endpoints: [
      {
        id: 'status',
        path: `/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=${ZTE_READ_VALUES.join(',')}`,
        parser: 'zte_status',
      },
    ],
  },
];
