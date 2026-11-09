<script setup lang="ts">
import type { ScanReport } from '../scan/scanner';
import WebModemPanel from './WebModemPanel.vue';

defineEmits<{ (e: 'imported', report: ScanReport): void }>();
</script>

<template>
  <details class="help">
    <summary>Can't see your modem?</summary>
    <p>
      A web page cannot look into the Windows Device Manager, so here are the steps to find out where it gets stuck.
    </p>
    <h3>1. Nothing shows up at all</h3>
    <ul>
      <li>Check the USB cable (many are charge-only) and that the modem has power.</li>
      <li>Try a USB 2 port, or an extension cable or a powered hub. Some modems dislike USB 3 ports.</li>
      <li>
        Look for the right name: in the browser's device list the Quectel EC200A appears as "Android" on a Mac, and
        possibly with no name at all on Windows without WinUSB.
      </li>
    </ul>
    <h3>2. It shows up, but there is no COM port</h3>
    <ul>
      <li>
        Look up the USB id (vendor:product, for example 2c7c:6005) in the Device Manager under "Details", property
        "Hardware Ids". The vendor id tells you who made the modem chip.
      </li>
      <li>
        Install the vendor's driver, which creates COM ports ("Serial port" button), or give the AT interface a WinUSB
        driver and use "USB direct".
      </li>
    </ul>
    <h3>My modem shows up as a disk</h3>
    <ul>
      <li>
        Many modems start as a small USB disk and switch to modem mode afterwards. In disk mode there is no AT
        channel. Eject the disk, wait a few seconds and connect again.
      </li>
      <li>The vendor's installer on the disk also switches it. On Linux, <code>usb_modeswitch</code> does it.</li>
    </ul>
    <h3>A disk appears and the modem is not in the list</h3>
    <ul>
      <li>
        On a Mac the browser does not offer a stick in storage mode at all: the system has taken it as a disk, so
        ModemLens cannot reach it and the list stays empty.
      </li>
      <li>Eject the disk and wait a few seconds. If the stick then switches mode, it appears in the list.</li>
      <li>
        If it stays a disk, it needs the vendor's installer from that disk (only on a machine where installing vendor
        software is acceptable), or a Linux machine with <code>usb_modeswitch</code>.
      </li>
    </ul>
    <h3>My modem has its own web page and no AT channel</h3>
    <p>
      Many network sticks can only be read from their own web page. A browser bookmark reads that page for you and
      saves a file, and ModemLens shows it in the same view.
    </p>
    <WebModemPanel @imported="$emit('imported', $event)" />
    <h3>3. Zadig (WinUSB driver)</h3>
    <ol>
      <li>
        Get Zadig only from its official site, <a href="https://zadig.akeo.ie/" target="_blank" rel="noopener">zadig.akeo.ie</a>.
        ModemLens does not bundle or distribute drivers.
      </li>
      <li>
        Start it, choose Options, "List All Devices", and pick only the interface named like "Mobile AT Interface" (for
        the EC200A, interface 3). Never pick the whole device.
      </li>
      <li>Select WinUSB as the target driver and press Replace Driver. Only change that one interface.</li>
      <li>
        To roll back: Device Manager, right-click the device, Properties, Driver, "Roll Back Driver" or "Uninstall
        device" and tick "Delete the driver software", then unplug and replug the modem.
      </li>
    </ol>
    <h3>4. Locked-down Windows PC</h3>
    <p>Without administrator rights you cannot install or replace drivers, so this does not work there. Use another PC.</p>
  </details>
</template>

<style scoped>
.help {
  padding: 0.9rem 1.2rem;
  font-size: 0.95rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
}
summary { cursor: pointer; font-weight: 600; }
h3 { margin: 1rem 0 0.25rem; font-size: 0.95rem; }
p { margin-top: 0.6rem; }
ul, ol { margin: 0.2rem 0; padding-left: 1.2rem; color: var(--ink-2); }
li { margin-block: 0.2rem; }
code { font-size: 0.86em; }
</style>
