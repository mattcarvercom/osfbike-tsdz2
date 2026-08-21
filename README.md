![GitHub issues](https://img.shields.io/github/issues/mattcarvercom/osfbike-tsdz2) [![Build Action](../../actions/workflows/build.yaml/badge.svg)](../../actions/workflows/build.yaml)

# osf.bike — TSDZ2 Smart eBike Firmware

Open-source replacement firmware for the Tongsheng TSDZ2 mid-drive motor's STM8-based controller, plus
its own from-scratch LVGL UI ("OSF Modern") for the 860C/850C color displays (SW102 support exists too,
running its original UI - not yet rewritten). Forked from
[emmebrusa/TSDZ2-Smart-EBike-1](https://github.com/emmebrusa/TSDZ2-Smart-EBike-1) — full credit for
the underlying motor firmware to Casainho, EndlessCadence, Leon, mspider65, and mbrusa (that fork's
maintainer); see the upstream repo's [wiki](https://github.com/emmebrusa/TSDZ2-Smart-EBike-1/wiki) and
the [Endless Sphere forum thread](https://endless-sphere.com/forums/viewtopic.php?f=30&t=110682) for the
general project's documentation, history, and community support. This README covers what's specific to
this fork: the browser-based build/flash/configure tooling (`tools/web_configurator`, hosted at
[flash.osf.bike](https://flash.osf.bike)) that replaced the project's original Java/native toolchain, the
display firmware rewrite, and general hardware/wiring notes.

Also credit to [dzid26/TSDZ2-Smart-EBike](https://github.com/dzid26/TSDZ2-Smart-EBike) — a separate,
independently-developed fork whose `firmwares/motor/tsdz2/src/` improvements (motor overrun mitigation, smoother startup
torque, wheel-speed/cadence math fixes, C23 support, cppcheck CI, compile-time config sanity checks) were
merged into this fork's history on 2026-08-18 via a full rebase (not a cherry-pick), so their original
commits/authorship are preserved intact in `git log`. See
[`UNIVERSAL_FIRMWARE_PLAN.md`](UNIVERSAL_FIRMWARE_PLAN.md#phase-2-tuning-firmware-ongoing)'s
"Phase 2: Tuning firmware" section for the full merge writeup, including the two real conflicts it
surfaced against this fork's own cruise-override/battery-sag work.

This firmware is adapted for Tongsheng-protocol displays (stock VLCD5, VLCD6, XH18, or other displays
with the same protocol and 6-pin Tongsheng connector, SW102, DZ41, 850C, or 860C). Compared to stock
firmware it makes the motor run more efficiently (more power, less energy use), the bike feel more
responsive, and supports more displays/peripherals. Note: firmware can't be written to Enerdan-sold TSDZ2
motors/controllers — those use a V2 controller with an XMC1300 microprocessor, not STM8.

## Building and flashing with the web configurator

- Open `tools/web_configurator` in a WebUSB-capable browser (Chrome/Edge). It builds firmware in-browser
  (SDCC compiled to WASM) and flashes over WebUSB via an ST-Link V2 — no local toolchain install required,
  works the same on Windows/Linux/macOS.
- See [`tools/web_configurator/README.md`](tools/web_configurator/README.md) for setup and usage, and
  [`tools/CLAUDE.md`](tools/CLAUDE.md) for the tool's internals and known SDCC/build quirks.
- Native flashing (`stm8flash`/OpenOCD) still works as a fallback; on Linux it needs a udev rule granting
  non-root USB access to the ST-Link V2 (idVendor 0483, idProduct 3748) in `/etc/udev/rules.d/`. WebUSB
  doesn't need this — the browser's own device picker handles permissions.
- `firmwares/motor/tsdz2/src/Makefile` note: `--out-fmt-elf --debug` is commented out of `DEBUG_FLAGS` — no available `objcopy`
  build (apt, official SDCC 4.4.0 tarball, Ubuntu jammy binutils) supports the STM8 ELF BFD target. SDCC
  emits Intel HEX natively instead, which `make flash`/`make backup` already expect.

### Hardware / wiring notes (ST-Link V2 / SWIM)

- SWIM wiring: GND, SWIM, VDD (**3.3V — not 5V**; the STM8S105 is a native 3.3V part, and 5V risks
  backfeeding the controller's onboard 3.3V regulator), and NRST — wired to the controller PCB's SWIM test
  points, routed out through the wheel-speed-sensor connector's housing opening for convenience.
- **The controller MCU is powered from the main battery pack** via its own onboard regulator — the ST-Link
  does not power the board. The battery must be connected or SWIM gets no response at all (`SWIM error
  0x04`).
- SWIM can be flaky on first attach even with the battery connected. If you see `IO error: expected N
  bytes but 0 bytes transferred` (different from the no-power error above): wiggle/reseat all 4 wires,
  power-cycle the battery with the ST-Link still attached, then retry immediately.
- Display power state does not matter for flashing — no need to power the display on for SWIM to work.

## Testing

Setup:

```
py -m venv .venv
.venv\Scripts\activate   # or: source .venv\Scripts\activate
pip install .
```

Usage:

```
pytest                            # run tests
pytest --coverage                 # with coverage report (probably won't work on Windows)
```

Any changes should have a corresponding unit test added, unless unfeasible. Tests with coverage also run
in CI.

## Editing environment

VSCode can be used for development:
1. Open the project's top folder as the workspace.
2. Install extensions from the recommended-extensions popup.
3. Configure Intellisense: Settings (`Ctrl+,`) → `@id:C_Cpp.default.systemIncludePath` → point at your
   SDCC installation's include folder (e.g. `C:\Program Files\SDCC\include`).
4. `Ctrl+Shift+B` to build the firmware.

## IMPORTANT NOTES

* Installing this firmware will void your warranty of the TSDZ2 mid drive.
* We are not responsible for any personal injuries or accidents caused by use of this firmware.
* There is no guarantee of safety using this firmware, please use it at your own risk.
* We advise you to consult the laws of your country and tailor the motor configuration accordingly.
* Please be aware of your surroundings and maintain a safe riding style.
