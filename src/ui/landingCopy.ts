/** Copy shared by the live landing page and the static copy built into index.html. */
export const LEDE =
  'See what your USB cellular modem is, whether it is on the network and how good the signal is. It runs in Chrome or Edge, and nothing leaves this page.';

export interface FaqEntry {
  question: string;
  answer: string;
}

/** Each answer starts with the direct answer, because that first sentence is what gets quoted. */
export const FAQ: FaqEntry[] = [
  {
    question: 'How can I read a USB LTE modem without installing software?',
    answer:
      'Open ModemLens in Chrome or Edge, plug in the modem and click USB direct. ModemLens reads the model, firmware, SIM state, network, signal quality, LTE bands and USB mode from the modem itself. On a Mac, an AT modem such as the Quectel EC200A needs no driver at all.',
  },
  {
    question: 'Which browsers work with ModemLens?',
    answer:
      'Chrome and Edge, or any other Chromium browser with WebUSB and Web Serial. Firefox and Safari do not offer these interfaces, so ModemLens cannot reach a modem there.',
  },
  {
    question: 'Which modems does ModemLens support?',
    answer:
      'Modems that answer AT commands over USB or a serial port. ModemLens has profiles for the Quectel EC200A and an ASR-based stick, and tries a standard command set on anything else. Sticks without AT commands, such as Huawei HiLink devices, can be read through a bookmark on the stick\'s own admin page.',
  },
  {
    question: 'Why does my modem not show up on Windows?',
    answer:
      'Windows is probably holding the modem\'s AT interface with another driver. Either install the vendor\'s driver and connect with Serial port, or give that one interface the WinUSB driver and connect with USB direct.',
  },
  {
    question: 'Does ModemLens change anything on my modem?',
    answer:
      'Only when you ask it to. The automatic scan sends read commands only. Settings such as APN, USB mode or NAT change in the Actions tab, one at a time and after you confirm, and currently only on the Quectel EC200A and the ASR stick.',
  },
  {
    question: 'Is my modem data uploaded anywhere?',
    answer:
      'No. What ModemLens reads from your modem stays in your browser, because the tool has no backend to send it to. The shareable report masks identifiers such as IMEI, IMSI and ICCID. Downloading the page itself is an ordinary web request. It appears in the server logs, which K-I-Soft evaluates for visitor statistics.',
  },
  {
    question: 'Is ModemLens free?',
    answer: 'Yes. ModemLens is free to use and open source under the MIT licence. It is built by K-I-Soft, a Swiss software company near Bern.',
  },
];
