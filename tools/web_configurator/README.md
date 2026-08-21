# TSDZ2 Web Configurator

A browser-based replacement for the old Java Swing configurator *and* the
shell scripts (`compile_and_flash_20.sh`, `firmwares/motor/tsdz2/src/Makefile`'s `backup`/`flash`
targets) around it: edit every firmware parameter with labeled, tooltipped
fields instead of a positional `.ini` file, back up the currently flashed
firmware, build a new one, and flash it - all in this one tab. The only
things you need installed are Node/npm (to run it) and a Chromium-based
browser (to flash) - no SDCC, no Java, no `stm8flash` binary, no scripts.

Runs as a static site meant to be cloned and run locally (`npm run dev`), not
hosted. See `UNIVERSAL_FIRMWARE_PLAN.md` in the repo root for the full design
history and rationale; this file is just the practical "how do I run/use/
rebuild this" reference.

## Quick start

```sh
git submodule update --init --recursive   # needed once, see "Submodules" below
npm install
npm run dev
```

Open the printed `http://localhost:5173/`-style URL. Everything - config
editing, firmware building, flashing - runs client-side; nothing is uploaded
anywhere.

## What you can do

- **Import** a legacy `.ini` from the Java configurator, or start from
  firmware defaults.
- **Edit** every parameter through a labeled UI: hover or tap the "?" next to
  a field for an explanation pulled from the parameter guide PDF and the
  firmware source; fields that are meaningless given other settings (e.g. a
  street-mode power limit when that limit is disabled) are greyed out and
  disabled automatically.
- **Save/load** your settings as `<name>.tsdz2.json` (this tool's own format;
  never overwrites the source `.ini`).
- **Build `firmware.hex`** entirely in this tab (see below) and either
  download it or flash it directly. (`config.h` is generated internally as
  part of this pipeline but isn't exposed as its own download anymore - the
  in-browser build makes that manual step unnecessary.)
- **Back up and restore over WebUSB** - reads flash, EEPROM, and option
  bytes off the connected MCU and downloads all three as `.bin` files (the
  same three reads `firmwares/motor/tsdz2/src/Makefile`'s `backup` target does), and can write
  any one of them back later. EEPROM is a real, meaningful backup even
  though the firmware doesn't (yet) use it for the bulk of `config.h`'s
  tunables - it does persist a handful of values across power cycles and
  reflashes today (see `firmwares/motor/tsdz2/src/eeprom.c`), including the OEM-display
  "save current configuration" snapshot and the initial battery
  state-of-charge seed.
- **Flash over WebUSB** with a real ST-Link V2/V21/V3 (clone or genuine),
  no `stm8flash` binary or drivers needed - Chrome/Edge/Brave/Opera only,
  served over `http://localhost` or `https://`.
- **Flash display firmware** (860C/850C/850C_2021 or SW102) from the
  separate "Display firmware" tab, flashing a stock/pre-built firmware file
  from [emmebrusa/Color_LCD_860C](https://github.com/emmebrusa/Color_LCD_860C)
  (or your own build of it). Two different transports depending on target:
  860C/850C/850C_2021 flash over a **UART bootloader** (a USB-UART adapter
  wired into the display's own motor-controller connector, via Web Serial -
  the real-world way these displays get flashed, since their SWD pins
  aren't reachable without opening a sealed case); SW102 still flashes over
  the same ST-Link/SWD connection as the motor, but only for a one-time
  bootloader+softdevice bootstrap on blank hardware. Flashing only for now,
  not building - see "Submodules" below for how this works.
- **Pick a built-in release** on either flashing page instead of always
  browsing for a file - both offer a dropdown of whatever release files
  currently exist in `releases/motor/` (motor, `.hex`) and
  `releases/display/` (display, `.hex` for SW102 or `.bin` for
  860C/850C/850C_2021), fetched fresh on every page load (not duplicated
  into this app - see `public/releases`, a symlink to `../../releases`, and
  `firmware-manifest-plugin.ts`). Drop a new file into either folder and it
  shows up automatically, no rebuild needed.

## In-browser firmware build

Clicking **"Build firmware.hex"** compiles the current settings into a
flashable `.hex` using SDCC's real STM8 toolchain (preprocessor, compiler,
assembler, linker), all compiled to WebAssembly and running in this tab. No
SDCC install, no Emscripten, nothing - it's fully self-contained.

This mirrors how [8bitworkshop](https://github.com/sehugg/8bitworkshop) runs
SDCC in-browser for Z80/6502 targets: SDCC's own driver normally spawns the
preprocessor/assembler/linker as separate OS processes, which doesn't work
under WASM, so each stage is built as its own WASM module and orchestrated
from JS instead (`src/sdcc-build.ts`), mirroring 8bitworkshop's
`compileSDCC`/`assembleSDASZ80`/`linkSDLDZ80` functions.

The pipeline per file is: **mcpp** (preprocess `#include`/`#define`) → **sdcc
`--c1mode`** (compile to STM8 assembly) → **sdasstm8** (assemble to `.rel`) →
**sdldstm8** (link everything, once, to `.ihx`). It builds all 32 firmware
source files plus a handful of SDCC runtime helpers (integer division/modulo,
`memcpy`, etc. - see `wasm-sdcc/build.sh` for the full list and why they're
needed) every time, so it takes a little while - this isn't incremental.

**If you have old firmware and rebuilt it here, the `.hex` won't byte-match —
that's expected, not a bug.** Two independent things change the bytes:

1. **SDCC version.** `vendor/sdcc` is pinned to **4.5.0**; the previously
   released `.hex` files were built with **4.4.0**. SDCC changed its code
   generation between those versions, so even two *native* builds of the same
   `config.h` differ across most of their bytes.
2. **Native vs in-browser toolchain.** The in-browser build runs SDCC compiled
   to WebAssembly, which links against Emscripten's libc++ instead of the
   libstdc++ a native build uses. SDCC's STM8 register allocator uses
   `std::nth_element` to prune equally-costed register assignments, and that
   call breaks ties differently under the two standard libraries, so it can
   pick a different (but equally valid) register assignment.

Neither difference changes how the firmware *behaves* on the bike — the two
outputs are the same firmware, just a different arrangement of the same
instructions. Treat in-browser builds as functionally equivalent, not
byte-identical, to native builds. To confirm a `.hex` corresponds to a set of
settings, compare the settings (via the `.tsdz2.json` file) rather than
diffing the `.hex` bytes.

This build has been validated against real, previously-flashed release
`.hex` files (imported from their source `.ini`, same base address, size
within ~2%), and — as of 2026-08-12 — the in-browser pipeline's *own* output
has now actually been flashed to two real controllers and bench-tested
through assist levels 0-5 with the display working normally; a full road
test is the remaining step. Full technical write-up of
the byte-difference root cause is in `../CLAUDE.md`.

The WebUSB flashing path itself had two real bugs, found and fixed the same
day while doing this: progress/error output could go completely missing
(a full-page-rerender bug), and a flash write could crash with "memory
access out of bounds" (a WASM stack overflow in the vendored `stm8flash`'s
"only write changed blocks" optimization). Both are fixed as of this
writing — see `../CLAUDE.md`'s "Build & flash page" section for the detail
if either resurfaces.

Two linker warnings always appear and are expected, not bugs:
`___sdcc_external_startup` and `___sdcc_heap_init` are optional hooks this
firmware has never defined - a real native `make` build shows the exact same
warnings, since `LIBS =` is empty in `firmwares/motor/tsdz2/src/Makefile` too.

## Submodules

Four vendored toolchains, none of which are this repo's own code:

| Path | What | Why vendored |
|---|---|---|
| `vendor/stm8flash` | [vdudouyt/stm8flash](https://github.com/vdudouyt/stm8flash) | Compiled to WASM for the motor controller's SWIM flashing and backup reads (`wasm/build.sh`) |
| `vendor/sdcc` | [swegener/sdcc](https://github.com/swegener/sdcc) mirror | Compiled to WASM for in-browser building (`wasm-sdcc/build.sh`) |
| `vendor/mcpp` | [museoa/mcpp](https://github.com/museoa/mcpp) | C preprocessor SDCC's `--c1mode` needs but doesn't include standalone; also compiled to WASM |
| `vendor/stlink` | [stlink-org/stlink](https://github.com/stlink-org/stlink) | Compiled to WASM for SWD-based display-firmware flashing - 860C/850C (STM32F103) reuses its real FPEC flash algorithm directly; SW102 (nRF51822, which stlink-org has no support for at all) uses a from-scratch NVMC routine built on its low-level SWD primitives instead (`wasm-display-flash/`) |

The display firmware itself (860C/850C/SW102) is **not** a submodule -
`firmwares/display/860C/` and `firmwares/display/SW102/` (repo root, not under
this directory's `vendor/`) are owned snapshot copies vendored from
[emmebrusa/Color_LCD_860C](https://github.com/emmebrusa/Color_LCD_860C) (see
each directory's own README.md for the exact pin/provenance). They started
as a single git submodule but were de-submoduled on 2026-08-19 so this repo
could edit the 860C/850C UI directly (an LVGL-based rewrite, replacing
µGUI) - `firmwares/display/SW102/` is a separate, independent copy that
stays untouched on the original µGUI stack. `firmwares/display/860C/`'s
`common` + `860C_850C` source backs both the Display firmware page's own
builds (once building is added there - flashing only for now) and the
Display UI sim page, which compiles it to WASM and runs it in a canvas
(`wasm-display-sim/` - see "Display UI sim" below).

If you cloned this repo without `--recursive`, run
`git submodule update --init --recursive` once for the four toolchain
submodules above (the display firmware needs no such step - it's plain
tracked source). You do **not** need to build these yourself to use the
app - the compiled WASM output is committed to `src/wasm/` (see below)
specifically so cloning and running just works.

## Rebuilding the WASM assets

Only needed if you change `wasm/*.c`/`wasm-display-flash/*.c` (the WebUSB
shims) or update the `vendor/sdcc`/`vendor/mcpp`/`vendor/stm8flash`/
`vendor/stlink` submodule pins - not for normal use.

Requires the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
on `PATH` (`source /path/to/emsdk/emsdk_env.sh`), plus standard native build
tools for the autotools-based `wasm-sdcc/build.sh` step: `autoconf`,
`automake`, `libtool`, `bison`, `flex`, and system `zlib`/`boost` headers
(only needed to satisfy `./configure` checks, not linked into the WASM
output). If emsdk ends up installed inside this directory (e.g. as
`.emtoolchain/`), `vite.config.ts` already excludes it from the dev
server's file watcher - a full SDK install is tens of thousands of files,
enough to hit the OS's inotify watch limit and crash `npm run dev`/
`npm run test:e2e` otherwise.

```sh
source /path/to/emsdk/emsdk_env.sh
tools/web_configurator/wasm/build.sh                # stm8flash -> stm8flash.mjs/.wasm
tools/web_configurator/wasm-sdcc/build.sh           # mcpp, sdcc, sdasstm8, sdldstm8 -> .mjs/.wasm + stm8-runtime/
tools/web_configurator/wasm-display-flash/build.sh  # stlink -> stlink-display-flash.mjs/.wasm
tools/web_configurator/wasm-display-sim/build.sh    # firmwares/display/860C -> display-sim.mjs/.wasm
```

All four scripts write into `src/wasm/` and print what they wrote; commit
the result. `wasm-sdcc/build.sh` is the most involved of the four (see its
comments for the specific gotchas it works around - old K&R-style C failing
under modern GCC, Emscripten's sysroot missing `zlib.h`/`boost`, the default
64KB WASM stack overflowing SDCC's parser, and a couple of others) - if it
breaks after a submodule update, that file's comments are the place to start.
`wasm-display-flash/build.sh` has its own gotchas from bypassing
`vendor/stlink`'s CMake build entirely (missing `STLINK_HAVE_*` defines,
`version.h` needing to be hand-generated) - see that file's comments.
`wasm-display-sim/build.sh` has its own too (a shim-header technique to
stand in for real STM32 hardware, and a C quote-include search-order
gotcha) - see `../CLAUDE.md`'s "Display UI sim" section for the full story.

## Display UI sim

The **Display UI sim** nav item (shown in every build, including
`npm run build`'s deployed output - not a dev-only tool) runs the real
860C/850C display UI - `firmwares/display/860C/common` + `860C_850C`, the
same source a real display boots - compiled to WASM and rendered live in a
canvas, driven by on-screen buttons and telemetry sliders instead of a real
motor. It's a way to see and click through the real UI (colors, layout,
fonts, screen navigation) without flashing real hardware - useful both for
iterating on the UI itself, and for anyone visiting the deployed site who
wants to preview what the display looks like before owning the hardware -
see `../CLAUDE.md`'s "Display UI sim" section for the full architecture.

**To iterate on it live** - edit `firmwares/display/860C/**/*.c`, save, and
watch the open sim tab update on its own - run this in its own terminal
alongside `npm run dev` (needs the Emscripten SDK on `PATH`, same as any
other WASM rebuild above):

```sh
source /path/to/emsdk/emsdk_env.sh
npm run watch:display-sim
```

It rebuilds `wasm-display-sim/build.sh` on every `.c`/`.h` save under
`firmwares/display/860C/` (or `wasm-display-sim/*.c` itself), which
rewrites `src/wasm/display-sim.{mjs,wasm}`; Vite's own dev-server file
watcher picks up the rewritten `.mjs` as a real source change and
full-reloads any open tab that imported it - confirmed empirically, not
just assumed, nothing extra to wire up. Edit → save → the sim tab updates
itself in a few seconds.

Since this source is now owned directly (de-submoduled 2026-08-19, see
`firmwares/display/860C/README.md` for provenance), edits here are ordinary
commits like anywhere else in this repo - no submodule-bump ceremony needed
for outside contributions.

## Development

```sh
npm run dev          # start the dev server
npm test             # run the pure-logic test suite (schema/import/UI-model/session/flasher/sdcc-link coverage)
npm run test:e2e     # headless-browser regression suite for DOM/session wiring (needs `npx playwright install chromium`; skips itself if not installed)
npm run build        # typecheck + production build to dist/
npm run preview      # serve the production build locally
npm run typecheck    # tsc --noEmit only, no bundle - fast feedback
npm run lint         # eslint
npm run lint:fix     # eslint --fix
npm run format       # prettier --write
npm run format:check # prettier --check
npm run check        # typecheck + lint + format:check, what CI runs first
npm run preflight    # check + test + test:e2e, the full local gate before pushing
```

`npm test` covers pure logic only - `main.ts` and the `render/*.ts` modules it
bootstraps can't be imported outside a real browser (they touch
`document`/`localStorage` at module scope or on render), so anything that's
really about DOM wiring (a click actually calling the right handler, state
actually surviving a refresh) lives in the separate
`npm run test:e2e` suite instead (`e2e/run.ts`), which drives a real headless
Chromium via Playwright's own bundled browser build (not the system's
desktop Chrome - see the file's own top comment for why). Run `npx
playwright install chromium` once to fetch it; the suite skips itself
(exit 0) with a hint if it's missing, so `npm test`/`npm run check` never
hard-fail locally without it. CI installs it explicitly (see
`.github/workflows/web-configurator.yaml`'s "Install Playwright Chromium"
step) so it's never skipped there. It deliberately does not attempt to
cover the real build/flash/backup/restore WASM+WebUSB flow end to end (no
ST-Link/board in headless CI, and the in-browser SDCC build alone takes
~30s); that flow's pure, historically-buggy logic (WASM result validation,
runtime-helper symbol resolution) is covered by `npm test` instead
(`flasher.test.ts`, `sdcc-link-discovery.test.ts`) - the hardware flow itself
is validated by actually flashing and riding (see `tools/CLAUDE.md`'s "Build
& flash page" section).

### CI

Two workflows watch `tools/web_configurator/**`:

- `.github/workflows/web-configurator.yaml` - on every push/PR that touches
  this directory: `npm run check` (typecheck/lint/format), `npm test`,
  `npm run build`, `npm run test:e2e`.
- `.github/workflows/web-configurator-supply-chain.yaml` - on any change to
  `package.json`/`package-lock.json` plus a weekly cron: installs through
  Socket Firewall (`sfw`, blocks known-malicious packages at install time),
  then runs a behavioral/obfuscation scan (`@lateos/npm-scan`) and an offline
  OSV CVE scan (`cve-lite`) against the lockfile. `.npmrc` sets
  `ignore-scripts=true` so `sfw` can vet packages before any install script
  runs.

## Known limitations

- The in-browser build always compiles everything - no incremental
  rebuilds, no caching between clicks.
- `config.h` → `.hex` is the only build direction; there's no `.hex` → `.ini`
  or other reverse export (a deliberate non-goal, revisit only on real
  demand).
- TSDZ8/TSDZ16 are out of scope everywhere in this tool - and not just by choice.
  TSDZ8 uses a different MCU entirely (Infineon XMC1302, ARM Cortex-M0, vs. this
  firmware's STM8S105), which SDCC can't target (no ARM backend) and this repo's
  `firmwares/motor/tsdz2/src/` firmware isn't written for. See `../../UNIVERSAL_FIRMWARE_PLAN.md`'s
  "Explicit non-goals" for the full rationale.
