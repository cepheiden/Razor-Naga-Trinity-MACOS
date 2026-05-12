# Naga Trinity Control – Project Notes

Electron + React app to drive a **Razer Naga Trinity Edition (VID 0x1532, PID 0x0067)** on macOS without Synapse.

## Hardware reality (verified, not from docs)

The Trinity FW behaves differently than the rest of the OpenRazer line. Things that look wrong but are correct:

- **2 physical RGB zones only**: Scroll Wheel (LED 0x01) + Logo (LED 0x04). The side plates (2/7/12-button) have **no LEDs**. LED 0x05 (BACKLIGHT) returns `FAIL`. LED 0x0a returns `OK` but drives nothing visible (phantom). LED 0x00 = broadcast to scroll + logo.
- **Brightness is global**, not per zone. Single command on LED 0x00.
- **No on-board RGB persistence**: even Synapse 3 doesn't save RGB to the mouse — it's daemon-managed. Per Razer Insider forum and OpenRazer PR #888 (`effect_storage` pattern). What DOES persist on-device: DPI stages, polling rate, basic button keymap.
- **Button-binding writes don't work** via blind probing. Read works (cls 0x02 cmd 0x84), all write candidates return `FAIL`. Reverse engineering would require a Wireshark capture from Windows + Synapse 3. The mouse's current EEPROM keymap is what stays — we read it but can't change it.

## Protocol cheat sheet (Trinity-specific quirks)

Talked to the device via **USB control transfers on iface 0x02** (not node-hid — macOS protects the keyboard-usage HID interfaces that Razer hides the vendor reports behind). Endpoint 0 stays open even though IOHIDFamily is bound, so no TCC permission needed.

```
SET_REPORT: bmRequestType=0x21, bRequest=0x09, wValue=0x0300, wIndex=0x02
GET_REPORT: bmRequestType=0xA1, bRequest=0x01, wValue=0x0300, wIndex=0x02
Report length: 90 bytes. CRC at byte 88 = XOR of bytes 2..87.
```

Transaction IDs **differ per command** on this device:
| Command | tx_id (byte 1) |
|---|---|
| Brightness (cls 0x0f cmd 0x04) | `0x3f` |
| Trinity static/breathing | `0x1f` |
| Other generic ext_matrix effects | `0x3f` (default) |

**Static effect needs a 2-step Trinity-specific sequence** (per OpenRazer `razermouse_driver.c` + `razerchromacommon.c`):
1. Mode switcher: `cls 0x0f cmd 0x02 size 0x06`, args `00 00 08 00 00 00`
2. Static: `cls 0x0f cmd 0x03 size 0x0e`, args `00 00 00 00 02` + 3× RGB slots (all same color — FW writes one color to all zones, no per-zone static).

Breathing on Trinity FW is implemented as static in OpenRazer — there's no real breathing animation. We follow the same behavior.

Spectrum/wave/reactive use the generic ext_matrix per-zone (`cls 0x0f cmd 0x02`).

## File map

- `electron/nagaDriver.ts` — USB control-transfer driver. Exports `applyHardwareProfile`, `applyRgbOnly`, `setRgbOff`, `listNagaDevices`. All async.
- `electron/main.ts` — IPC handlers + `powerMonitor` hooks (`lock-screen` / `unlock-screen` / `suspend` / `resume` → brightness 0 / re-apply active profile).
- `electron/profileStore.ts` — JSON persistence at `app.getPath('userData')/profiles.json`. Has `migrateButtons` for old → new base-button layout migration (detects legacy `base-6` with `action=dpi-up`).
- `src/store/useNagaStore.ts` — Zustand store + its own copy of `baseBindings` / `SIDE_PLATE_LABELS` (kept in sync with `profileStore.ts` manually — duplicated knowledge).

## Base button layout (9 buttons, post Wheel-Tilt migration)

```
base-1 LMB, base-2 RMB, base-3 MMB, base-4 Scroll↑, base-5 Scroll↓,
base-6 Wheel Tilt Left, base-7 Wheel Tilt Right,
base-8 DPI+, base-9 DPI−
side-1..side-12 Side panel buttons (twelve plate)
```

## What works vs what doesn't

| Feature | On-device | Status |
|---|---|---|
| RGB (scroll + logo) | volatile (daemon-managed) | ✅ verified |
| DPI stages | EEPROM persistent | ✅ verified (set/read round-trip) |
| Polling rate | EEPROM persistent | ✅ verified |
| **Side-Button-Bindings** | **EEPROM persistent** | **✅ verified (Wireshark-decoded from Synapse 3 traffic, 2026-05-12)** |
| Macros (multi-step) | n/a (daemon-side) | ✅ globalShortcut-Engine fires when Naga sends F13-F24 |
| Wheel Tilt L/R remap | configurable in UI | ❌ scroll-wheel sources (0x34/0x35) use type 01/01 — write path unknown |

## Side-button binding write protocol (Wireshark-decoded)

From `naga_synapse_capture.pcapng` (Synapse 3 saving a profile):

```
SET_REPORT:  bmRequestType=0x21, bRequest=0x09, wValue=0x0300, wIndex=0x00, wLength=90
Razer report:
  byte[0] = 0x00 (status)
  byte[1] = tx_id (Synapse uses a rolling counter; FW accepts any value, 0x1f tested)
  byte[5] = 0x0a (data size)
  byte[6] = 0x02 (cls = button mapping)
  byte[7] = 0x0c (cmd = set binding)
  byte[8] = slot (1-4; profile slot)
  byte[9] = 0x40 + (button_index - 1)  // source ID for side buttons 1-12
  byte[10] = 0x00
  byte[11] = 0x02  // action major: key
  byte[12] = 0x02  // action minor: key
  byte[13] = 0x00
  byte[14] = HID keycode (target key the button should send)
  byte[15-87] = 0x00 (padding)
  byte[88] = CRC (XOR of bytes 2-87)
  byte[89] = 0x00
```

**Crucial Synapse pattern**: each binding is written **TWICE — first to slot 2, then to slot 1**. Writing only to slot 1 returns `status=OK` but is silently dropped — the FW only commits when both writes happen in that order. Implemented in `nagaDriver.ts` `applySideBindings`.

Other source IDs observed in capture (not implemented):
- 0x34, 0x35 — scroll wheel tilt/wheel; use action type 01/01 (system action, not keystroke)
- 0x40-0x4b — the 12 side panel buttons; use action type 02/02 (keystroke)

**Default Razer side-button HID codes** (what the mouse sends out-of-the-box):
- Buttons 1-9: HID 0x1e-0x26 (`1`-`9`)
- Button 10: HID 0x27 (`0`)
- Button 11: HID 0x2d (`-`)
- Button 12: HID 0x2e (`=`)

**Our app's macro-mode mapping**: When a side button has `action='macro'`, `applyHardwareProfile` writes that button to F13-F24 (HID 0x68-0x73) instead of its default. The macroEngine then registers `globalShortcut` for the corresponding F-key. This avoids globalShortcut hijacking common typing keys.

| Side button | Macro-mode HID | globalShortcut |
|---|---|---|
| 1 | 0x68 | F13 |
| 2 | 0x69 | F14 |
| ... | ... | ... |
| 12 | 0x73 | F24 |

## Open work / next steps

- ✅ **Tray + Auto-Launch + Auto-Apply** done (2026-05-12). App registers as login item via `app.setLoginItemSettings`, lives in menu bar via `Tray`, hides window on close, re-applies active profile on startup, RGB off on lock/sleep + restore on unlock/wake.
- ✅ **Variante A + Side-Button-Writes** done (2026-05-12 evening) — `nagaDriver.ts` `applySideBindings` writes the EEPROM bindings during `applyHardwareProfile`. Side buttons with `action='macro'` get F13-F24, others get the Razer default 1-12 keys. `macroEngine.ts` registers globalShortcut for F13-F24 matching the macro-mode buttons. End-to-end: user configures macro in UI → "Apply" → mouse hardware-binding rewritten + globalShortcut registered → user presses physical side button → mouse sends F-key → globalShortcut fires → osascript types the macro text. No conflict with normal typing because F13-F24 are unused on macOS.
- ✅ **Bilingual UI (DE / EN)** done (2026-05-12 night) — `src/i18n/` with `i18next` + `react-i18next` + browser language detector. Auto-detects from `navigator.language`, manual switch in sidebar footer (`.lang-button` DE / EN), persisted in `localStorage` key `naga:lang`. Renderer also writes the choice back via `app:update-settings` → main process re-caches `cachedLang` and rebuilds the tray menu in place. Main has its own small `TRAY_STRINGS` table (DE/EN) since the tray is built before the renderer loads.
- ✅ **RGB-off-on-lock toggle** done (2026-05-12 night) — new `AppSettings.rgbOffOnLock` (default `true`), stored in `profiles.json`. Tray menu checkbox "RGB beim Sperren ausschalten" / "Turn RGB off when screen locks". `powerMonitor` lock-screen/suspend handlers check the setting before calling `setRgbOff`; unlock/resume always restore. IPC `app:get-settings` / `app:update-settings`.
- **Variante B** (native macOS CGEventTap with USB Vendor/Product filter via Swift addon) — only needed if user wants macros on side buttons currently bound to letters/symbols (their Btn1-5 = ' ` h i k). Architectural blueprint already in `## About OpenRazer as a reference source` above. Estimated ~3-4h.
- The two `BASE_BUTTONS` / `SIDE_PLATE_LABELS` duplicates between `useNagaStore.ts` and `profileStore.ts` should be extracted to a shared module.
- UI: surface which side buttons have active shortcuts vs. skipped (Engine returns `{ registered, skippedUnsafe, noKeymap }` from `registerProfileShortcuts`, but main.ts doesn't pass it to renderer yet).
- UI: settings toggle for "open at login" (currently only in tray menu).

## Macro engine architecture (Variante A)

`electron/macroEngine.ts`:
- `readSideKeymap()` (from `nagaDriver.ts`) returns the 12 EEPROM HID codes for the side panel.
- `HID_TO_ACCELERATOR` maps HID Usage IDs (0x3a-0x73 range) to Electron accelerator strings. Anything outside this map is treated as "unsafe" and skipped.
- `executeMacro(macro)` runs steps sequentially via `osascript`/`System Events`. Text steps become `keystroke "..."`, key steps fall back to a small key-code table (Enter/Tab/Esc/Arrows) or `keystroke` for printable values, delay steps `setTimeout`. Repeat mode `count` is honored; `while-held` and `toggle` are not (globalShortcut only fires press).
- `registerProfileShortcuts(profile)` clears all shortcuts, reads keymap, registers one per side button that has `action='macro'` + safe key. Returns `{ registered, skippedUnsafe, noKeymap }`.
- `globalShortcut` swallows the original keystroke when fired, so users don't get both the macro AND a Home/F7/etc. keypress.

**macOS Accessibility permission required for keystroke injection.** First macro execution will trigger the system prompt; user must grant access to the Electron binary in System Settings → Privacy & Security → Accessibility. Once granted, the prompt doesn't reappear.

**Limit of Variante A** (inherent, not a bug): if the user presses one of the bound F-keys (e.g., F7) on their *physical keyboard*, the macro also fires. With the user's current EEPROM mapping (F7/F8/F10/PrtSc/Insert/ScrollLock/Home), these keys are rarely typed on a Mac, so the cross-talk is in practice tolerable.

## About OpenRazer as a reference source

OpenRazer's entire `driver/` tree IS the community's reverse-engineering work — Razer never published specs. Verified by full repo grep (`/tmp/openrazer/`):

### Official Naga Trinity capabilities in OpenRazer (the hard limit)

From `driver/razermouse_driver.c` line 6868, the device-attribute registration block, and confirmed by `pylib/openrazer/_fake_driver/razernagatrinity.cfg`:

```c
case USB_DEVICE_ID_RAZER_NAGA_TRINITY:
    CREATE_DEVICE_FILE(... dev_attr_dpi);
    CREATE_DEVICE_FILE(... dev_attr_poll_rate);
    CREATE_DEVICE_FILE(... dev_attr_matrix_brightness);
    CREATE_DEVICE_FILE(... dev_attr_matrix_effect_static);
    break;
```

That's the **complete** list. No breathing/spectrum/wave/reactive — they exist in our driver because the FW accepts the generic ext_matrix commands, but OpenRazer didn't expose them. From `daemon/openrazer_daemon/hardware/mouse.py:508`:

```python
class RazerNagaTrinity(__RazerDevice):
    HAS_MATRIX = False  # TODO Device supports matrix, driver missing
    DEDICATED_MACRO_KEYS = True
    METHODS = ['get_device_type_mouse', 'get_dpi_xy', 'set_dpi_xy', 'get_poll_rate',
               'set_poll_rate', 'get_brightness', 'set_brightness',
               'set_static_effect', 'max_dpi']
```

Two important comments here: (1) per-zone matrix RGB is acknowledged but not implemented — open TODO. (2) `DEDICATED_MACRO_KEYS = True` is set, **but** the line below it that would instantiate the key manager is commented out:

```python
# self.key_manager = _NagaHexV2KeyManager(self._device_number, self.event_files,
#                                         self, use_epoll=True, ...)
```

So the macro support for the Trinity was scaffolded and **abandoned mid-implementation**.

### How OpenRazer does macros on Linux (the pattern we'd need on macOS)

`daemon/openrazer_daemon/misc/key_event_management.py` `KeyboardKeyManager`:

1. Open `/dev/input/event*` for the device (side panel exposes as kbd-input).
2. `ioctl(fd, EVIOCGRAB, 1)` (`0x40044590`) — exclusively claim the device so X/Wayland never see the keystrokes.
3. Read events from the grabbed file descriptor.
4. Translate scancode → configured macro action, replay via `uinput`.

**macOS equivalents:**
| Linux | macOS |
|---|---|
| `/dev/input/event*` | `IOHIDManager` callbacks, or `CGEventTap` |
| `EVIOCGRAB` ioctl | `CGEventTap` returning `NULL` to swallow events, or `IOHIDDeviceOpen(kIOHIDOptionsTypeSeizeDevice)` |
| `uinput` replay | `CGEventPost` |
| Filter by device | `CGEventGetIntegerValueField(event, kCGKeyboardEventSenderUSBVendorID/ProductID)` |

A `CGEventTap` at `kCGSessionEventTap` with `(eventTypes: keyDown | keyUp)`, callback checks vendor=0x1532 product=0x0067, looks up macro from current profile, runs it, returns `NULL`. Needs Accessibility permission. This is the cleanest path for Variante B.

### Quick lookup index for trinity-specific code

- `driver/razermouse_driver.c:1077` static effect 2-step protocol
- `driver/razermouse_driver.c:2193` brightness write (tx 0x3F)
- `driver/razermouse_driver.c:2258` brightness read (tx 0x3F)
- `driver/razermouse_driver.c:6868` capability registration (the hard limit list)
- `driver/razerchromacommon.c` `razer_naga_trinity_effect_static` — the only Trinity-specific function

Refs: [openrazer/driver/](https://github.com/openrazer/openrazer/tree/master/driver) · [PR #888 effect_storage](https://github.com/openrazer/openrazer/pull/888) (the daemon-side state-persistence pattern they chose over hardware writes).

## Things that wasted time and shouldn't again

- Don't use `node-hid` for this device on macOS. Iface 0 (mouse) opens but reports go to the wrong place; iface 1/2 are protected ("DevSrvsID:..." errors). Use `usb` (libusb) with control transfers on endpoint 0.
- Don't trust `status=0x02 OK` from GET_REPORT as proof the effect applied. FW returns OK for syntactically valid commands even when it ignores them (e.g., generic static on this device returns OK but doesn't visibly change LEDs; only the Trinity-specific 2-step works).
- Don't fall back to `devices[0]` when enumerating HID interfaces — that's the mouse interface that macOS keyboard-protection blocks.
- `device.interface` from node-hid is `-1` / unreliable on macOS. Use `usagePage` for filtering on Mac, `interface` only as a Linux/Windows hint.
