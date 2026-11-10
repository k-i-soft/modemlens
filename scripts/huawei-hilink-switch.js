#!/usr/bin/env node
/*
 * huawei-hilink-switch.js
 *
 * Switches a Huawei LTE stick that shows up as a USB disk (mode 12d1:1f01)
 * into its HiLink network mode, so its web page at http://192.168.8.1 comes
 * up. After that you can read the modem with the ModemLens bookmarklet.
 *
 * Why a separate script: a web page cannot do this. WebUSB forbids pages from
 * touching USB mass-storage devices, and the operating system holds the disk
 * interface anyway. So the switch has to run outside the browser, once.
 *
 * It sends the standard, reversible Huawei switch message. It writes nothing
 * to the modem's storage and changes no stored setting. Unplugging and
 * replugging brings the stick back to disk mode.
 *
 * Usage:
 *   npm install usb            # once, in this folder (needs libusb)
 *   node huawei-hilink-switch.js          # Linux
 *   sudo node huawei-hilink-switch.js     # macOS (the OS holds the disk, so root is needed)
 *
 * On Windows the stick usually switches and installs on its own; this script
 * is for macOS and Linux. On Linux, `usb_modeswitch` does the same job.
 *
 * Part of ModemLens (https://github.com/k-i-soft/modemlens), MIT licence.
 */
'use strict';

let usb;
try {
  usb = require('usb');
} catch (e) {
  console.error('The "usb" package is missing. Run:  npm install usb');
  process.exit(1);
}

const VENDOR_HUAWEI = 0x12d1;
const STORAGE_PRODUCT = 0x1f01;
// SCSI command wrapper that asks the stick to leave disk mode. Reversible on replug.
const SWITCH_MESSAGE = Buffer.from('55534243123456780000000000000011062000000100000000000000000000', 'hex');

function findStorageStick() {
  return usb.getDeviceList().find(
    (d) => d.deviceDescriptor.idVendor === VENDOR_HUAWEI && d.deviceDescriptor.idProduct === STORAGE_PRODUCT,
  );
}

function bulkOut(device) {
  const iface = device.interfaces[0];
  if (process.platform !== 'win32' && iface.isKernelDriverActive()) {
    iface.detachKernelDriver();
  }
  iface.claim();
  const ep = iface.endpoints.find((e) => e.direction === 'out');
  if (!ep) throw new Error('no bulk OUT endpoint on the disk interface');
  return { iface, ep };
}

function main() {
  const device = findStorageStick();
  if (!device) {
    console.log('No Huawei stick in disk mode (12d1:1f01) found.');
    console.log('Plug the stick in and run this again. If it already shows a web page, it is switched.');
    process.exit(2);
  }
  device.open();
  let iface;
  try {
    const out = bulkOut(device);
    iface = out.iface;
    out.ep.transfer(SWITCH_MESSAGE, (err) => {
      // A pipe error here is normal: the stick resets itself before acknowledging.
      if (err) console.log('Sent (the stick reset before acknowledging, which is expected).');
      else console.log('Switch message sent.');
      try { iface.release(true, () => device.close()); } catch { device.close(); }
      console.log('Wait a few seconds, then open http://192.168.8.1 and run the ModemLens bookmarklet.');
    });
  } catch (e) {
    console.error('Could not reach the disk interface:', e.message);
    if (process.platform === 'darwin') console.error('On macOS run this with sudo.');
    try { device.close(); } catch { /* already closed */ }
    process.exit(1);
  }
}

main();
