# Razer Naga Trinity – macOS Controller

Electron + React app for the **Razer Naga Trinity (VID `0x1532`, PID `0x0067`)** on macOS. Replaces Razer Synapse for the things macOS users actually need:

- RGB (scroll wheel + logo, with multiple effects)
- DPI stages and active-stage cycling
- Polling rate (125 / 500 / 1000 Hz)
- Side-panel button remapping, persisted in EEPROM
- Multi-step macros (text auto-type) triggered from side buttons
- Optional RGB-off when the screen locks / sleeps (toggleable in the tray menu); auto-restore on unlock/wake
- Auto-launch at login, lives in the menu bar (tray-mode daemon)
- **Bilingual UI: German / English**, auto-detected from the system locale, manually switchable in the sidebar footer. Tray menu follows the same language.

The mouse keeps its DPI / polling / button mapping after unplug, sleep, reboot — only RGB and macros require the app running (limitation of the firmware, same as Synapse).

Not affiliated with Razer. Community reverse-engineering project.

## Requirements

- macOS 13 (Ventura) or newer; tested on macOS 15.5 Sequoia (Darwin 25.x)
- Node 20+ (Node 26 confirmed)
- A Razer Naga Trinity Edition (PID `0x0067`)
- Free USB port (the mouse must be wired during use)

## Installation

### From source (current state)

```bash
git clone git@github.com:cepheiden/Razor-Naga-Trinity-MACOS.git
cd Razor-Naga-Trinity-MACOS
npm install
npm run dev
```

On first launch:

1. **Plug the Naga Trinity in.** The app opens with a menu-bar diamond icon and a main window. UI language is detected from the system locale (German or English). Switchable any time via the **DE / EN buttons in the sidebar footer**.
2. Click **"Send to mouse" / "An Maus senden"** — RGB, DPI, polling rate, and (if configured) side-button bindings are written to the mouse.
3. **First macro use** triggers a macOS permission prompt for *Accessibility*. Grant it: *System Settings → Privacy & Security → Accessibility* → enable **Electron**. If the prompt doesn't appear, add `node_modules/electron/dist/Electron.app` manually. After granting, restart Electron (`pkill -9 Electron && npm run dev`).
4. Optionally enable **"Launch at macOS login"** from the tray menu — the app then auto-launches on login, lives invisibly in the menu bar, and applies the active profile on every startup.
5. The tray menu also has **"Turn RGB off when screen locks"** — checked by default. Uncheck it if you want the lights to keep glowing during lock/sleep.

### Packaging a stand-alone app

```bash
npm run build           # full production build (tsc + vite + esbuild)
npm run electron:pack   # creates an unsigned .app in release/
```

For a signed/notarised release for distribution, configure `electron-builder` in `package.json` with your Apple Developer cert.

## Troubleshooting

- **`cannot open device with path DevSrvsID:...`** – legacy `node-hid` error. Should not happen with this codebase (we use `usb` / libusb on endpoint 0). If you see it, another instance of Electron is already running.
- **Macro fires but nothing types** – Accessibility permission missing for Electron. Re-grant and restart.
- **Side buttons still send numbers 1-9 after configuring a macro** – click "An Maus senden" once; the hardware-binding only writes when you explicitly apply.
- **Lights stay off after USB replug** – expected. Razer firmware can persist DPI and bindings but **not** RGB (per Razer's own design; even Synapse can't). The app re-applies RGB automatically on startup; just have it auto-launch.

## How it works

The driver talks to the device via `libusb` control transfers on endpoint 0 — bypasses `IOHIDFamily` and the macOS *Input Monitoring* permission that would normally block access to the Razer vendor HID interface (which macOS exposes as a keyboard usage).

Side-button macros work by **remapping the physical buttons to F13–F24** on the mouse hardware (`SET_REPORT` to `cls 0x02 cmd 0x0c`, two-step write to profile slots 2 + 1 per Synapse's pattern), then catching those F-keys in the app via Electron's `globalShortcut` and replaying user-defined text via `osascript`. F13–F24 are unused on macOS so this doesn't conflict with normal typing.

See [`CLAUDE.md`](./CLAUDE.md) for the protocol details (Trinity-specific 2-step static effect, transaction IDs per command class, button-binding write format, Wireshark capture findings).

## Status

| Feature | Hardware-side | App-side |
|---|---|---|
| RGB (scroll + logo) | volatile while powered | ✅ applied on profile send + auto-restored on unlock/wake |
| DPI stages | persistent (EEPROM) | ✅ set + verified via round-trip read |
| Polling rate | persistent (EEPROM) | ✅ set + verified |
| Side-button bindings | persistent (EEPROM) | ✅ writable, Wireshark-decoded |
| Macros (text auto-type) | uses F13-F24 trick | ✅ `globalShortcut` + `osascript` |
| Auto-launch + tray | n/a | ✅ login-item + menu-bar daemon |
| Bilingual UI (DE / EN) | n/a | ✅ auto-detect + manual switch, persists across restarts; tray menu localised too |
| RGB-off-on-lock toggle | n/a | ✅ togglable in tray menu, persists in `profiles.json` |
| Wheel-tilt remap | unknown source action type | ⚠️ UI-only, not pushed to hardware |
| Profile-slot switcher | reads work, write path unverified | 🚧 planned |
| Per-key colors / matrix RGB | unverified (OpenRazer marks as `HAS_MATRIX = False  // TODO`) | 🚧 not implemented |

## Stack

Electron 42, React 19, Vite 8, TypeScript 6, `usb` (libusb N-API), Zustand, `i18next` + `react-i18next` (with `i18next-browser-languagedetector`). No external native build step — `usb` ships N-API prebuilts that work in both Node and Electron.

## Sources and credits

This project would not have been possible without the following.

### Reverse-engineering reference

- **[OpenRazer](https://github.com/openrazer/openrazer)** – Linux kernel driver and userspace daemon for Razer devices. The community's foundational reverse-engineering work. Specifically referenced:
  - [`driver/razermouse_driver.c`](https://github.com/openrazer/openrazer/blob/master/driver/razermouse_driver.c) – per-device case blocks including the Trinity static-effect 2-step protocol, transaction-ID quirks per command class, brightness command. The capability registration around line 6868 defines the hard Trinity limit (DPI, poll rate, brightness, static effect — nothing else officially).
  - [`driver/razerchromacommon.c`](https://github.com/openrazer/openrazer/blob/master/driver/razerchromacommon.c) – `razer_naga_trinity_effect_static` (the only Trinity-specific helper exported).
  - [`pylib/openrazer/_fake_driver/razernagatrinity.cfg`](https://github.com/openrazer/openrazer/blob/master/pylib/openrazer/_fake_driver/razernagatrinity.cfg) – confirms the four supported sysfs attributes.
  - [`daemon/openrazer_daemon/misc/key_event_management.py`](https://github.com/openrazer/openrazer/blob/master/daemon/openrazer_daemon/misc/key_event_management.py) – the `EVIOCGRAB`-based Linux pattern for capturing macro keys; used as the architectural blueprint for the planned native-macOS Variante B.
  - [Trinity class in `mouse.py`](https://github.com/openrazer/openrazer/blob/master/daemon/openrazer_daemon/hardware/mouse.py) – the `HAS_MATRIX = False  # TODO Device supports matrix, driver missing` comment is what alerted us to the gaps in OpenRazer's Trinity support.
  - [PR #888 – Local device state storage](https://github.com/openrazer/openrazer/pull/888) and [PR #1149 – Persistence storage](https://github.com/openrazer/openrazer/pull/1149) – the daemon-side state-persistence pattern OpenRazer chose for non-persistent firmware state (the model we adopted for RGB).
  - [Issue #541 – Naga Trinity support](https://github.com/openrazer/openrazer/issues/541) – community discussion thread.

### Hardware specs and behaviour

- **[Razer Insider Forum – Naga Trinity On-Board Memory](https://insider.razer.com/mice-and-surfaces-9/naga-trinity-on-board-memory-9754)** – Razer staff/vanguard confirmation that the Trinity stores only DPI, polling, and basic keybindings on-board; RGB and complex macros require running software.
- **[Razer Insider Forum – Naga Trinity On-Board Profiles](https://insider.razer.com/mice-and-surfaces-9/naga-trinity-on-board-profiles-2102)** – confirms 4 onboard slots and the bottom switch button.
- **[Razer Naga Trinity master guide (PDF)](https://dl.razerzone.com/master-guides/RazerSynapse/NagaTrinity-00000103-en.pdf)** – Razer's official user manual; useful for the physical button layout and side-plate variants.
- **[USB HID Usage Tables (PDF, USB-IF)](https://www.usb.org/sites/default/files/hut1_5.pdf)** – HID keyboard usage IDs (`0x04`–`0xa4`) used for translating between key names and the raw codes the FW expects.

### Protocol RE for the button-binding write path

The `cls 0x02 cmd 0x0c` command structure was derived from a **Wireshark + USBPcap capture of Razer Synapse 3** running on Windows. The captured `.pcapng` file from a profile-save action with the Trinity attached was decoded with `tshark`. Synapse 3 itself is © Razer Inc.; only the on-wire bytes it emits — which are a function of the firmware's protocol, not Synapse's code — were observed and reproduced.

### Build/runtime dependencies

- **[`usb`](https://github.com/node-usb/node-usb)** (npm `usb` package) – N-API libusb bindings for Node and Electron. ABI-stable across Node v20-26 and Electron 22+.
- **[Electron](https://electronjs.org)** – `app.setLoginItemSettings`, `Tray`, `Menu`, `globalShortcut`, `powerMonitor`, `systemPreferences.isTrustedAccessibilityClient`.
- **[Vite](https://vitejs.dev) / [`@vitejs/plugin-react`](https://github.com/vitejs/vite-plugin-react)** – dev server and bundler for the renderer.
- **[Zustand](https://github.com/pmndrs/zustand)** – state store in the renderer.
- **[`i18next`](https://www.i18next.com) + [`react-i18next`](https://react.i18next.com)** + **[`i18next-browser-languagedetector`](https://github.com/i18next/i18next-browser-languageDetector)** – DE/EN translation runtime in the renderer with persistence in `localStorage`. The Electron main process keeps its own small translation table for the tray menu (it's built before the renderer loads).
- **[esbuild](https://esbuild.github.io)** – bundles the Electron main + preload (`build:electron` script).
- **[Wireshark / `tshark`](https://www.wireshark.org)** + **[USBPcap](https://desowin.org/usbpcap/)** – Windows-side USB capture for the Synapse RE.

### macOS APIs and behaviours referenced

- [`CGEventTap`](https://developer.apple.com/documentation/coregraphics/quartz_event_services) and `kCGKeyboardEventSenderUSBVendorID` – the "proper" Variante-B path for per-device event filtering (not yet implemented; documented in `CLAUDE.md` as future work).
- [System Events / `osascript` `keystroke`](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/) – used for the macro replay.
- TCC – [Apple's Privacy & Security overview](https://support.apple.com/guide/security/secace5e1da/web) – why `osascript` and `globalShortcut` need Accessibility permission.

## License

MIT — see [LICENSE](./LICENSE).
