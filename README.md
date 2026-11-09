# ModemLens

ModemLens surveys USB cellular modems from the browser. Plug a modem in, connect, and it reads what the modem reports: identity, SIM state, network, signal quality, bands and USB mode. It shows the results as a live instrument panel and can export a report. It is a static web page; there is no server and nothing to install.

## Supported browsers

Chrome and Edge (any Chromium browser with WebUSB and Web Serial). Firefox and Safari do not offer these APIs, so ModemLens cannot talk to a modem there.

## Connecting a modem

- **USB direct** (WebUSB). ModemLens talks to the modem's AT interface itself. On Windows this needs a WinUSB driver on that interface.
- **Serial port** (Web Serial). Use this when the vendor's driver already exposes the modem as a COM port or serial device.

### Windows and WinUSB

If the USB list shows no modem, or the modem has no name, Windows is probably holding the AT interface with another driver. Either install the vendor's driver and use **Serial port**, or give the AT interface the WinUSB driver (for example with the open-source Zadig tool, taken only from its official site). Replace the driver on that one interface only, never on the whole device. The in-app help walks through this step by step.

## Which modems work

- **AT modems.** Modems that answer AT commands over USB or serial work. Profiles describe the exact commands per model; for other modems ModemLens falls back to a standard 3GPP/V.250 command set. The automatic scan only sends read-only commands. Settings change only in the Actions tab (Quectel EC200A only), one at a time, after you confirm each change.
- **Modems without AT** (router-style or HiLink devices that expose a web interface instead). Use the web bookmarklet: it captures what the modem's own admin page shows, saves it to a file, and ModemLens imports that file.

## Privacy

- Modem data stays in your browser. It is never uploaded; ModemLens has no backend and no analytics, and loads no third-party scripts.
- The shareable export is masked: identifiers such as IMEI, IMSI and ICCID are redacted.
- Downloading the page itself is an ordinary web request, so the host that serves it may log it, like any website.

## Adding a modem profile

Profiles are JSON files in `src/profiles/`, registered in `src/profiles/index.ts`. A profile has an `id`, a `label`, a `match` (USB `vvvv:pppp` ids and/or a model name pattern), optional `usb` hints (which interface carries AT), a list of `commands`, and a `denyCommands` list of commands that must never be sent. Every command marked `"phase": "auto"` must be a read form, which the test suite enforces. Copy an existing profile, adjust it, add it to the list, and run `npm test`. New profiles should start with `"verified": false` until someone has confirmed them on real hardware.

## Development

```
npm ci
npm test
npm run dev
npm run build
```

`npm run dev` starts the Vite dev server; open it with `?demo=1` to try the interface without a modem. `npm run build` type-checks and writes the static site to `dist/`, including a service worker so the app shell starts offline. The tests that inspect `dist/` run only when a build exists.

The page is built so that a strict Content-Security-Policy works: no inline scripts, no inline style blocks, no external resources. Set the policy as a response header on your host.

`scripts/deploy_frontend.sh` publishes `dist/` to S3 behind CloudFront. It reads its configuration from environment variables (see the comment at the top of the script) and contains no account details.

## Origin of the code

ModemLens is original work. It was written from public standards (3GPP TS 27.007, ITU-T V.250 and related specifications) and from vendors' public AT command documentation, not from the source code of any other tool.

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 K-I-Soft.

Donations are optional and never required. If ModemLens saved you time, a donation link may be shown in the app.
