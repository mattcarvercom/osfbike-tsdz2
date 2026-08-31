![GitHub issues](https://img.shields.io/github/issues/mattcarvercom/osfbike-tsdz2) [![Build Action](../../actions/workflows/build.yaml/badge.svg)](../../actions/workflows/build.yaml)

# osf.bike — TSDZ2 Smart eBike Firmware

Open-source replacement firmware for the Tongsheng TSDZ2 mid-drive motor's STM8-based
controller, plus a from-scratch LVGL dashboard ("OSF Modern") for the 860C/850C/850C
(2021) color displays. Forked from
[emmebrusa/TSDZ2-Smart-EBike-1](https://github.com/emmebrusa/TSDZ2-Smart-EBike-1) — full
credit for the original motor firmware to Casainho, EndlessCadence, Leon, mspider65, and
mbrusa (that fork's maintainer); see the upstream repo's
[wiki](https://github.com/emmebrusa/TSDZ2-Smart-EBike-1/wiki) and the
[Endless Sphere forum thread](https://endless-sphere.com/forums/viewtopic.php?f=30&t=110682)
for the wider project's history and community support. Also credit to
[dzid26/TSDZ2-Smart-EBike](https://github.com/dzid26/TSDZ2-Smart-EBike), a separate
independent fork whose motor-firmware improvements (overrun mitigation, smoother startup
torque, wheel-speed/cadence math fixes, cppcheck CI) were merged into this fork's history
via a full rebase, preserving their original commits/authorship in `git log`.

Adapted for Tongsheng-protocol displays: stock VLCD5/VLCD6/XH18/DZ41/DZ40, SW102, 850C,
850C (2021), and 860C. Compared to stock firmware the motor runs more efficiently, the
bike feels more responsive, and more displays/peripherals are supported. Firmware can't
be written to Enerdan-sold TSDZ2 motors/controllers — those use a V2 controller with an
XMC1300 microprocessor, not STM8.

**Real-hardware status**: flashed and ridden on a Varstrom 48V TSDZ2B 500W motor, with
both a DZ40 display and a Bafang-standard 860C color display running this fork's own
OSF Modern UART firmware.

**What's actually been rewritten vs. what's still upstream:**

- **Motor firmware** (`firmwares/motor/tsdz2/`) — this fork's own tuning/robustness work
  on top of the emmebrusa/dzid26 base (see `UNIVERSAL_FIRMWARE_PLAN.md`), still the same
  STM8S105 target and overall structure as upstream.
- **860C / 850C / 850C (2021) display firmware** (`firmwares/display/860C/`) — full
  rewrite of the UI: main riding screen, graph screens, config screen, boot screen, and
  fault screen, all built on LVGL instead of the stock µGUI bitmap-font renderer (see
  `firmwares/display/860C/README.md`). Flashed and ridden on a real 860C as noted above;
  850C/850C (2021) share the same source but haven't had their own hardware pass yet — see
  `CHANGELOG.md` for current status before flashing one.
- **SW102 display firmware** (`firmwares/display/SW102/`) — still runs its original
  upstream UI; not rewritten, and not flashable from the web configurator today (no known
  SWD pinout for the initial bootstrap — see `SW102_FIRMWARE_NOTES.md`).

## Repository layout

Six top-level folders:

| Path | What |
|---|---|
| `firmwares/` | The actual firmware source: `motor/tsdz2/` (STM8, SDCC) and `display/860C/` + `display/SW102/` (see above for which UI each runs). |
| `tools/` | `web_configurator/` — the browser-based build/flash/configure tool (see below), hosted at [flash.osf.bike](https://flash.osf.bike). |
| `releases/` | Pre-built firmware the web configurator offers as built-in picks, split into `motor/` and `display/` — see each folder's own `README.md` for naming/versioning. |
| `settings/` | Reusable `.ini`/`.tsdz2.json` config profiles the web configurator can load — `proven/` (field-tested starting points, incl. "Reset to defaults") and `experimental/` (real bike-specific configs still being tuned). |
| `tests/` | Native pytest/cffi harness that compiles the real motor firmware source into an x86 shared lib for behavioral testing. |
| `docs/` | Vendor-published parameter guides and display manuals (PDF/ODT), referenced by the web configurator's field tooltips. |

## Building and flashing with the web configurator

- Open `tools/web_configurator` in a WebUSB-capable browser (Chrome/Edge). For the motor
  firmware it builds in-browser (SDCC compiled to WASM) and flashes over WebUSB via an
  ST-Link V2 — no local toolchain install required, works the same on
  Windows/Linux/macOS.
- Display firmware (860C/850C/850C (2021)/SW102) is **flashed**, not built, from the
  configurator's separate "Display firmware" tab — pick a built-in release from
  `releases/display/` or upload your own `.bin`/`.hex`. Building the 860C/850C UI from
  source is still a manual native-toolchain step; see `860C_FROM_SOURCE_BUILD.md`.
- See [`tools/web_configurator/README.md`](tools/web_configurator/README.md) for setup
  and usage, and [`tools/CLAUDE.md`](tools/CLAUDE.md) for the tool's internals and known
  SDCC/build quirks.
- Native flashing (`stm8flash`/OpenOCD) still works as a fallback for the motor firmware;
  on Linux it needs a udev rule granting non-root USB access to the ST-Link V2
  (idVendor 0483, idProduct 3748) in `/etc/udev/rules.d/`. WebUSB doesn't need this — the
  browser's own device picker handles permissions.
- `firmwares/motor/tsdz2/src/Makefile` note: `--out-fmt-elf --debug` is commented out of
  `DEBUG_FLAGS` — no available `objcopy` build (apt, official SDCC tarball, Ubuntu jammy
  binutils) supports the STM8 ELF BFD target. SDCC emits Intel HEX natively instead,
  which `make flash`/`make backup` already expect.

### Hardware / wiring notes (ST-Link V2 / SWIM)

- SWIM wiring: GND, SWIM, VDD (**3.3V — not 5V**; the STM8S105 is a native 3.3V part, and
  5V risks backfeeding the controller's onboard 3.3V regulator), and NRST — wired to the
  controller PCB's SWIM test points, routed out through the wheel-speed-sensor
  connector's housing opening for convenience.
- **The controller MCU is powered from the main battery pack** via its own onboard
  regulator — the ST-Link does not power the board. The battery must be connected or
  SWIM gets no response at all (`SWIM error 0x04`).
- SWIM can be flaky on first attach even with the battery connected. If you see
  `IO error: expected N bytes but 0 bytes transferred` (different from the no-power error
  above): wiggle/reseat all 4 wires, power-cycle the battery with the ST-Link still
  attached, then retry immediately.
- Display power state does not matter for flashing — no need to power the display on for
  SWIM to work.
- 860C/850C/850C (2021) display firmware flashes over its own UART bootloader instead —
  a USB-UART adapter wired into the display's motor-controller connector, via Web Serial.
  No SWIM/ST-Link involved for those targets.

## Testing

```sh
uv sync                     # or: pip install -e .
uv run pytest tests/        # run tests
uv run pytest tests/ --coverage --strict   # matches CI's actual invocation
```

Any changes to `firmwares/motor/tsdz2/src/` should have a corresponding unit test added,
unless unfeasible — see the `tests/` section of `CLAUDE.md` for how the harness works.
Tests with coverage also run in CI.

## Further documentation

| Doc | What |
|---|---|
| `CHANGELOG.md` | What's changed since the two firmwares were reorganized under `firmwares/` — the best single place to see current status. |
| `UNIVERSAL_FIRMWARE_PLAN.md` | Design history and rationale for the web configurator, the motor-firmware merge, and the longer-term universal-firmware direction. |
| `SW102_FIRMWARE_NOTES.md` | Why SW102 isn't flashable from the web configurator yet, and what's been confirmed about its build/OTA pipeline. |
| `860C_FROM_SOURCE_BUILD.md` | How to build the 860C/850C display firmware from source outside the browser tool. |
| `releases/README.md`, `releases/*/README.md` | What's shipped as a built-in flashable release, and the naming/versioning convention. |

## IMPORTANT NOTES

* Installing this firmware will void your warranty of the TSDZ2 mid drive.
* We are not responsible for any personal injuries or accidents caused by use of this firmware.
* There is no guarantee of safety using this firmware, please use it at your own risk.
* We advise you to consult the laws of your country and tailor the motor configuration accordingly.
* Please be aware of your surroundings and maintain a safe riding style.
