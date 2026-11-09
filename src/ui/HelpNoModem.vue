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
h3 {
  margin: 0.8rem 0 0.2rem;
  font-size: 0.95rem;
}
ul,
ol {
  margin: 0.2rem 0;
  padding-left: 1.2rem;
}
summary {
  cursor: pointer;
}
</style>
