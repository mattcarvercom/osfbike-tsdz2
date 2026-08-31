# Universal Firmware + Modern Configurator — Plan

Status (2026-08-18): **5 phases**, sequenced by what unlocks the most value with the
least risk first, not strictly by dependency order.

| Phase | What | Status |
|---|---|---|
| 1 | Configurator replacement (`tools/web_configurator`) | **Complete** |
| 2 | Tuning firmware — real-world bike tuning/robustness work | **Ongoing**, by nature never "done" |
| 3 | Display firmware flashing (860C/850C, SW102) via SWD | **Shipped, hardware verification pending** |
| 4 | Universal firmware (EEPROM migration, display autodetect) | Deferred, contingent |
| 5 | Display firmware *compiling* in the web configurator | Not started |

This doc is the durable record of what we decided and why, so it survives context
resets. Written 2026-08-10, updated 2026-08-18 (5-phase restructure; also absorbed
the former standalone `FUTURE_ENHANCEMENTS.md` into "Open / ongoing" below, so
firmware-change candidates live in one place instead of two files).

## Goals

1. **Universal firmware** — one compiled TSDZ2 binary that works across display models
   and voltage classes, instead of a separate `config.h`/recompile per display type.
2. **EEPROM-backed tuning** — move the tuning constants riders actually iterate on out
   of compile-time `#define`s and into runtime EEPROM fields, so changing them doesn't
   require a full recompile + reflash of program flash.
3. **New cross-platform configurator** — a browser-based tool (WebUSB + WebSerial,
   works identically on desktop and Android Chrome from one codebase, no native app
   build) replacing the Java Swing configurator, with a real keyed config format
   instead of the current positional value-dump `.ini`.
4. **No-laptop field tuning, without forcing a transport choice** — the same web tool
   supports multiple pluggable transports for writing EEPROM values: ST-Link V2 (wired
   laptop, or Android + USB-OTG) via WebUSB, and a plain UART or Bluetooth-serial
   bridge via WebSerial for people who don't want a debug probe at all. Full firmware
   reflash still requires ST-Link/SWIM regardless of transport choice for tuning.

## Explicit non-goals

- **TSDZ8/TSDZ16 support.** We only run TSDZ2/TSDZ2B. Don't build or ship TSDZ8 in
  anything we write. Don't touch or remove TSDZ8 code in the existing Java configurator
  either — it's a live, wanted feature for other users of the upstream project (see
  Community context below), just not something we maintain. This isn't only "we don't
  own the hardware" — confirmed 2026-08-13 (via `github.com/mstrens/OSF`, the TSDZ8
  firmware fork) that TSDZ8 uses a genuinely different MCU (Infineon XMC1302, 32-bit
  ARM Cortex-M0, vs. TSDZ2's 8-bit STM8S105), built with ARM GCC via Infineon
  ModusToolbox (not SDCC — SDCC has no ARM backend, so this repo's in-browser
  WASM-SDCC pipeline couldn't target it even in principle) and flashed with Segger
  J-Flash over J-Link (not `stm8flash`/WebUSB/SWIM — SWIM is STM8-specific). None of
  `tools/web_configurator`'s build/flash pipeline is reusable for TSDZ8; it would be a
  second toolchain from scratch, not an extension. TSDZ16 turned up no information at
  all (not in this repo, not on the linked TSDZ2 wiki, not in OSF) — unconfirmed as a
  real distinct product. The one thing that *does* carry across Tongsheng's motor
  lineup: the UART2 display protocol (VLCD5/VLCD6/XH18/850C/EKD01) is shared
  ecosystem-wide, independent of which MCU runs the motor controller — OSF's own docs
  claim "same functionalities... same (4 or more) displays as the [emmebrusa] project."
  That's why this plan's display-autodetection work (Goal 1) stays TSDZ2-scoped without
  needing to special-case TSDZ8 — the two projects only overlap at that protocol layer,
  never at the toolchain layer.
- **Regenerative braking.** Ruled out: the rear wheel's freehub (standard on any
  derailleur bike) mechanically disconnects the chain from the motor during coasting
  and braking, regardless of any TSDZ2 internal gearbox clutch revision. Real regen
  would need a front-wheel direct-drive hub motor as a separate system — a much bigger,
  optional, future project, not part of this plan.
- **Making this repo public / adding emmebrusa as a real upstream fork for PRs — for
  now.** Deferred on purpose. If something here turns out well enough to contribute
  back, the plan is: fork upstream publicly *then*, rebase a single clean commit on top
  of it, and send that as a scoped PR. Not doing the public/fork step preemptively.
- **Exporting the new config format back to legacy `.ini` — for now.** The web
  configurator imports old `.ini` files one-way; it never writes them. Anyone who wants
  to keep using the Java tool and raw `.ini` files can keep doing exactly that,
  untouched — this is a personal project, so the intent is for the new tool to be where
  usage migrates to, not to maintain a bidirectional bridge. Revisit only if real
  demand shows up later.

## Current-state findings (evidence gathered, not to be re-derived)

**Repo status (as of 2026-08-10, before the dzid26 merge below - stale, kept for
history):** fully caught up with `emmebrusa/TSDZ2-Smart-EBike-1` — merge-base equals
upstream's current head (`2c944f1`, `v20.1C.6-update-6-fix`). 19 local commits ahead,
all bike-tuning specific (DZ40 PAS fix, battery gauge sag compensation, power ceiling
bump, walk-assist PAS-level fix, etc.). Nothing missing from upstream.

**Current repo status (2026-08-18):** 658 commits total - this fork's own 620 commits
rebased onto [dzid26/TSDZ2-Smart-EBike](https://github.com/dzid26/TSDZ2-Smart-EBike)'s
38-commit `firmwares/motor/tsdz2/src/` improvement series (motor overrun mitigation, wheel-speed/cadence
fixes, C23 support, etc.), landing at `2c944f1` (the same shared ancestor as above) via
a full history rebase rather than a merge/squash, preserving both sides' original
authorship. `emmebrusa/TSDZ2-Smart-EBike-1` (`upstream`, read-only) has not been
re-checked for new commits since; the merge-base-equals-upstream-head claim above no
longer applies now that this fork's history has been rewritten onto a different tree.
Full writeup in Phase 2's dzid26-merge entry below.

**Chip:** STM8S105x6 (per `Makefile` target `stm8s105?6`) — 32KB flash, and per the
STM8S105x6 datasheet ~1024 bytes true data EEPROM at `0x4000+` (this figure is from the
datasheet, not verified against anything in-repo — confirm before it's load-bearing).

**EEPROM headroom:** only 20 of ~1024 bytes currently used (`EEPROM_BYTES_STORED` in
`eeprom.h`). Migrating literally every scalar `config.h` constant (worst case, no
packing) costs ~167 bytes — still under 20% of the chip's EEPROM. Capacity is not the
constraint.

**Flash headroom (as of 2026-08-10 - stale, not yet re-measured post-dzid26-merge):**
measured directly from an actual flashed release
(`releases/<bike-name>-TSDZ2-20.1C.6-6-20260809-090216EDT.hex`, decoded as Intel HEX):
**23,372 / 32,768 bytes used, 9,396 bytes (28.7%) free.** dzid26's merge both adds code
(overrun mitigation, rev matching) and removes some (`__divulong` call-site reductions),
net effect unmeasured - no release has been rebuilt/reflashed since the 2026-08-18
merge. Re-measure from the next real release build before treating this figure as
current; the EEPROM-migration conclusions below aren't sensitive to a few hundred bytes
either way, but don't cite this exact number as fresh.

**`config.h` has 146 scalar `#define`s (as of 2026-08-10 - also since grown)**, though
dzid26's merge added none (confirmed empty `config.h` diff between the shared ancestor
and its tip - see Phase 2's dzid26-merge entry below), so only this fork's own
subsequent work (`CRUISE_OVERRIDE_WALK_ECO/TOUR/SPORT/TURBO_ENABLED`,
`BATTERY_VOLTAGE_SAG_FILTER_SHIFT`, its indicator toggle, etc. - all documented in
Phase 2) has grown this count since. The EEPROM-migration feasibility conclusion
(comfortably under the chip's ~1024-byte budget even in the worst case) isn't sensitive
to this drift - a handful of added toggle/threshold fields doesn't change the
order-of-magnitude headroom math - so this wasn't recounted precisely. Of the original
146:
- **125 fit in a `uint8`**, 21 need 2 bytes (12 are the `LI_ION_CELL_VOLTS_*` floats,
  needing x100 fixed-point encoding; the rest just exceed 255, e.g. `WHEEL_PERIMETER`,
  `TARGET_MAX_BATTERY_POWER`, `POWER_ASSIST_LEVEL_4`).
- **~30+ of the 146 are used in real `#if`/`#elif` preprocessor conditionals** — code for
  the disabled path doesn't exist in the binary at all today (`ENABLE_LIGHTS`,
  `COASTER_BRAKE_ENABLED`, `CRUISE_MODE_ENABLED`, `FIELD_WEAKENING_ENABLED`, all the
  `ENABLE_VLCD5/VLCD6/XH18/850C/EKD01` display flags, `PWM_FREQ == 19`,
  `TEMPERATURE_SENSOR_TYPE == TMP36`, etc.). These can't become plain EEPROM values
  without restructuring the code to always compile in and branch at runtime instead —
  that's real work, and it grows the flash image. This is a distinct task from simple
  EEPROM migration, see Architecture decisions below.
- **Cross-value compile-time safety interlocks exist** and would silently stop
  protecting anything if the underlying values became independently, freely writable:
  `main.h:167` forces `MOTOR_ASSISTANCE_WITHOUT_PEDAL_ROTATION` to 0 if
  `ADC_TORQUE_SENSOR_OFFSET_ADJ` is too small relative to two other torque-offset
  constants; similar clamps exist for walk-assist (`main.h:454`) and cruise
  (`main.h:473`) thresholds. Any config value feeding one of these needs the check
  reimplemented as real validation logic wherever it now lives (see below).
- **Display-flag code footprint is small**: `ENABLE_VLCD5/VLCD6/XH18/850C/EKD01`
  together appear in only 14 code locations across the whole C source — divergence
  between display protocols is modest (mostly small conditional tweaks, not five
  parallel implementations), which is why folding them into one autodetecting binary
  looks feasible within the measured flash headroom.
- **"TSDZ2B" doesn't appear anywhere in the C source.** The only voltage-class-relevant
  compile-time flag is `MOTOR_TYPE` (`main.h:91`, selects the FOC angle multiplier for
  36V vs 48V motors). Voltage class is **not cleanly autodetectable** — 36V and 48V pack
  resting-voltage ranges overlap near the boundary (a low 48V pack can read close to a
  full 36V pack) — so plan for an explicit one-time user selection stored in EEPROM,
  not true autodetection.
- **TSDZ8 in this repo's C source is a single dead `#define`** (`MOTOR_TYPE_TSDZ8`,
  never read anywhere). All real TSDZ8 handling lives in the Java configurator's
  separate Intel-HEX-patching code path (`mstrensHexLine`), entirely bypassing
  `config.h`/SDCC/`make`. We don't touch this.
- **`config.h`'s header comment (`Automatically created by TSDS2 Parameter
  Configurator / Author: stancecoke`, typo included) is byte-identical to the
  `firmwares/motor/tsdz2/src/config.h` in `github.com/mstrens/OSF`, the TSDZ8 firmware fork** - confirmed
  2026-08-13 by diffing the two files directly. `MOTOR_TYPE_TSDZ8` sits at the exact
  same line number in both, flipped 0→1; OSF's version is equally dead - grepped every
  `.c`/`.h` in their `firmwares/motor/tsdz2/src/`, never read there either. So the config-file *schema* was
  already shared across TSDZ2 and TSDZ8 by the same Java generator tool before either
  fork existed; only the compiler/MCU target diverged. Nothing to act on here, just
  useful context for why `MOTOR_TYPE_TSDZ8` looks deliberate but isn't.

**Existing Java configurator mechanics** (for reference, not to be re-derived):
- `.ini` files are positional (`BufferedReader.readLine()` per GUI field, zero keys/
  schema) because save writes both the `.ini` line and the `config.h` `#define` line
  from the *same* single top-to-bottom field walk — not a designed format, a side
  effect of the save loop's implementation.
- Save fully regenerates `firmwares/motor/tsdz2/src/config.h` from scratch every time (verified 1:1 diff
  against the checked-in file, except one dead field), then shells out to
  `compile_and_flash_20.sh`/`.bat` (`make clean && make all`, then optional flash).
- One confirmed dead/vestigial control: `CB_STARTUP_ASSIST_SPEED_LIMIT_ENABLED` — hidden
  (`setVisible(false)`, line 635) with its write logic fully commented out
  (`/* NOT USED */`, lines 2373-2381).

**Firmware robustness gaps found (independent of this plan, worth bundling in since
they're cheap):**
- **No IWDG (independent watchdog) armed anywhere**, despite the peripheral lib
  supporting it. Fix: enable IWDG with a real timeout, feed once per confirmed-good
  main loop pass, check `RST_FLAG_IWDGF` at boot, and surface a new fault code through
  the existing E02-E09-style display channel (`ui8_system_state`/
  `ui8_display_fault_code`) if the last boot was a watchdog recovery. Note: brake state,
  overcurrent, overspeed, and undervoltage cutoffs already run inside the PWM
  interrupt independent of the main loop (`motor.c:780-825`), so a main-loop hang isn't
  a stuck-throttle scenario — brake still works — but the assist current target can
  freeze at its last commanded value until brake/power-cycle, hence wanting the fault
  light rather than treating this as just a nit.
- **Overvoltage only affects the displayed SOC bar, not actual current/PWM.** Only
  undervoltage gates PWM today (`motor.c:813`). Not urgent without regen, but cheap to
  mirror symmetrically.

**Community context (from `emmebrusa/TSDZ2-Smart-EBike-1` issues/PRs, checked
2026-08-10):**
- **PR #144 (CPU load):** real profiling showed `uart_send_package()` blocking the main
  loop via a busy-wait on UART TX-empty; fixed by making TX interrupt-driven (~99% cut).
  Same pass removed some expensive `_divulong()` calls. Lessons for us: (a) pull in the
  interrupt-driven UART TX fix regardless of this plan — it buys back CPU headroom;
  (b) any display-protocol autodetection must detect once and cache, never
  re-evaluate every loop; (c) `main.c` has an unused `TIME_DEBUG` hook
  (`ui8_max_ebike_time`) — enable it and get real loop-timing numbers on real hardware
  before finalizing the universal-firmware design, don't guess.
- **Issue #150:** emmebrusa (maintainer) has independently stated the intended
  direction: *"I have to change the logic, in the C code there will no longer be any
  reference to the type of display, but only to the functions that differentiate the
  various models. The reference to the type of display will only be in the
  configurator..."* — this is the same universal-display-handling idea in this plan,
  as the maintainer's own stated intent, not something we invented. Worth coordinating
  once we have something concrete to show.
- **Issue #141:** a live design negotiation between emmebrusa and mstrens (maintainer
  of a related TSDZ8 fork, `github.com/mstrens/OSF`) already solved several problems
  we'd otherwise solve from scratch: a **version byte written into the generated
  config** so firmware can validate compatibility before applying it; **signed values
  encoded via a fixed offset** (e.g. a -5..+5 range stored as 95-105); **reserved
  padding fields** for future additions without breaking existing installs. mstrens
  explicitly floated the same "one compiled version, hex-flash the user parameters"
  idea from the other direction. emmebrusa explicitly refuses to expose
  `MOTOR_ROTOR_OFFSET_ANGLE`/`FOC_ANGLE_MULTIPLIER` in the configurator — calls them
  "delicate parameters" needing a real calibration procedure, not user feel — precedent
  for which constants stay expert-only/hidden in our tool too.
- **#191, #137, #150 (rest):** minor — a stale option array in the Java tool (already
  fixed upstream), editor/tooling chit-chat, and a tangential-but-real debate about
  whether "battery power limit" should scale with measured voltage at all. Not
  actionable for this plan.

## Architecture decisions

- **Firmware changes land in this repo** (`TSDZ2-Smart-EBike-1`), via branch + PR for
  review before merge — same workflow already established for anything touching `firmwares/motor/tsdz2/src/`.
- **The web configurator lives under `tools/` in this same repo**, not a separate one.
  This matches upstream's own convention — `tools/Java_Configurator_Source` already
  existed at the upstream merge-base, before any of our fork-specific commits — and
  matters more now that public-fork-for-PRs is a real (if deferred) possibility.
  Discipline: keep configurator commits and firmware-source commits scoped separately,
  so a future upstream-bound PR can be cleanly extracted without dragging unrelated
  web-tool changes along.
- **WebUSB + WebSerial over a native Go/Fyne app.** Both APIs are Chromium-only (Chrome,
  Edge, Brave, Opera — Firefox and Safari have declined to implement either; this is a
  hard wall for iOS specifically, since every iOS browser is forced onto Apple's WebKit
  regardless of branding, not a temporary gap). Accepted trade-off given only Android is
  actually in scope. In exchange: one artifact instead of per-OS native builds, no
  code-signing/Gatekeeper/SmartScreen friction, and critically — WebUSB is the *same
  API* on desktop Chrome and Android Chrome, so "laptop with ST-Link" and "phone with
  ST-Link over OTG" become one code path instead of two, with Chrome (not us) handling
  the Android USB-permission flow. Must be served over HTTPS or localhost — a bare
  double-clicked `file://` page does not count as a secure context and WebUSB/WebSerial
  won't work. **Intended serving method: run locally**, not hosted — clone the repo,
  `npm run dev` (or equivalent) to serve the WASM app on `localhost`, which satisfies
  the secure-context requirement without deploying anywhere. No GitHub Pages / public
  hosting planned.
- **Pluggable EEPROM-write transports, not one hardcoded path**, to avoid forcing a
  device/workflow choice on people who already have a laptop+ST-Link routine:
  - **WebUSB → ST-Link V2 (SWIM)** — same transport also used for full firmware
    reflash. Works from desktop Chrome (wired) or Android Chrome (USB-OTG).
  - **WebSerial → plain UART adapter or Bluetooth-serial bridge (e.g. HC-05-style
    Classic SPP module)** — EEPROM-only, no debug probe needed. A BT-serial module is
    transparent to the STM8 firmware (it just sees UART2 bytes, wired or wireless,
    with zero firmware-side difference) and can be powered directly off the display
    connector as a small standalone dongle.
  Both transports write the same EEPROM schema (see below); the tool just needs a
  transport-selection step, not two separate implementations of the config logic.
- **`stm8flash` itself gets ported to WASM, not shelled out to.** Rather than a Node
  backend spawning the native `stm8flash.exe` (today's `tools/tool-stm8flash`) the way
  the Java tool used `Runtime.exec()`, vendor the actual upstream `stm8flash` C source
  (vdudouyt/stm8flash — not this repo's own code) and compile it with Emscripten,
  replacing its libusb transport calls with a small shim that forwards to WebUSB. This
  removes the native-binary/libusb dependency entirely, keeps the config editor a pure
  static page (no local backend process), and inherits a known-working SWIM
  implementation instead of reimplementing the ST-Link protocol from scratch. Tractable
  in a way the SDCC-to-WASM idea below isn't: `stm8flash` is a single translation unit
  talking to one transport, with no subprocess spawning, so it doesn't hit WASM's
  no-multi-process wall. Vendor as a git submodule (tracks upstream fixes) under
  `tools/web_configurator/vendor/stm8flash`, separate from the existing prebuilt-binary
  `tools/tool-stm8flash` folder (which stays as-is for anyone still using the Java tool
  or CLI `make flash`).
- **The tuning-transport protocol reuses the display-autodetection mechanism**, rather
  than being a separate bolted-on thing: it's registered as one more candidate protocol
  (its own sync byte + checksum scheme) in the same try-parse-and-lock-on detection
  loop already planned for telling VLCD5 apart from XH18, etc. Physical constraint to
  remember: UART2 is a single point-to-point link, so using this path means unplugging
  the display and connecting the tuning adapter instead, not both at once (no bus
  arbitration hardware planned — swapping a connector at a stop is an acceptable
  workflow, same as today's laptop+cable routine).
  - **Resolving the "you lose the display while tuning" tradeoff**: the tuning tool
    doesn't have to just replace the display, it can *become* one. `uart_send_package()`
    (`ebike_app.c` ~3005) already streams a full telemetry packet to whatever's on UART2
    — battery gauge, torque sensor, current/power, speed, errors — none of it
    display-hardware-specific, just bytes any listener can decode. Since the tool
    already has to parse this protocol both directions for display autodetection, adding
    a live-rendered virtual dashboard (speed/battery/assist-level/errors) alongside the
    tuning controls is a natural extension, not new scope. Same single UART2 swap-in as
    today's laptop+cable routine, but now with full status *and* live knob-turning
    instead of losing the readout - genuinely usable for tuning feel while riding, not
    just while parked.
- **New, isolated, additive work doesn't need a branch** (per earlier agreement) — only
  changes touching `firmwares/motor/tsdz2/src/` (firmware C, `config.h`, `eeprom.c`, etc.) require branch + PR.
- **EEPROM schema versioning:** extend the existing `DEFAULT_VALUE_KEY` byte pattern in
  `eeprom.c` into a real schema-version field the firmware validates before applying a
  config, so a config written by an incompatible tool version fails loudly instead of
  silently misapplying. Borrows mstrens's version-byte pattern from issue #141.
- **Signed values:** fixed offset encoding (e.g. +100), per mstrens's pattern, rather
  than switching representations to `int16` everywhere.
- **Derived/formula constants** (e.g. the `LI_ION_CELL_VOLTS_*` → `BATTERY_SOC_VOLTS_*`
  chain): computed **host-side in the Go tool at save time**, writing only the final
  resolved integer to EEPROM. This avoids runtime float/division cost on the
  FPU-less STM8 — but means those derivation formulas must be faithfully reimplemented
  in Go and kept in sync with the C source's intent. Real cost, worth it for this
  narrow case (pure-config-derived formulas only — formulas that mix a config constant
  with a live sensor reading can't be precomputed and don't need to be; moving that
  constant to EEPROM only costs one extra RAM load either way).
- **Cross-value safety interlocks** (the `main.h:167`-style clamps): reimplemented as
  validation logic in the Go tool at save/write time, mirroring what the C preprocessor
  does today, rather than trusting arbitrary EEPROM writes to be self-consistent.
- **Config constants split into three buckets**, not one blanket migration:
  1. **Compile-time-only** — hardware-identity and `#if`-gating flags (voltage class,
     `PWM_FREQ` class, `TEMPERATURE_SENSOR_TYPE`, and today's display-type flags once
     autodetect replaces them). Stay real `#define`s / get restructured, not EEPROM'd.
  2. **Plain runtime tuning values** — no `#if` dependency, not in an ISR hot path
     (most of the current-limit/ramp/threshold numbers actually iterated on). Low-risk,
     high-value EEPROM migration candidates.
  3. **Host-precomputed derived values** — float-derived or multi-input formulas,
     resolved in Go at save time per above.
- **Universal display support:** don't compile every display's `#if` branch in
  simultaneously as-is. Follow emmebrusa's stated direction (issue #150) — restructure
  so C code contains only the functions that differentiate models, selected by a
  runtime display-type value. Autodetect via try-parse + checksum validation against
  each known protocol's framing at boot/reconnect; cache the result once locked on;
  never re-attempt detection every loop (per the PR #144 CPU-budget lesson).
- **Watchdog + fault display, overvoltage cutoff:** bundle in as independent, low-risk,
  cheap additions per the findings above — not gated on the rest of this plan.

## Phased plan

**Reordered 2026-08-11, restructured into 5 phases 2026-08-18.** Originally sequenced
firmware-first (EEPROM migration before the web tool). Inverted: the two biggest
quality-of-life wins — killing Java and enabling phone-based flashing — don't actually
depend on any firmware or EEPROM work, so they shipped first (Phase 1), against the
*current, unchanged* `config.h`/`.ini` firmware. Two more phases have shipped or are
shipping alongside Phase 1's original scope: ongoing bike tuning (Phase 2 — this was
always happening, just wasn't previously called out as its own phase) and display
firmware flashing (Phase 3, added 2026-08-18, extending the tooling beyond the motor).
The original firmware-refactor plan is now Phase 4, still deferred/contingent exactly
as before — just renumbered, not reprioritized. Phase 5 (compiling display firmware
in-browser, not just flashing pre-built `.hex`) is a new, not-yet-started idea that
naturally follows once Phase 4's display-EEPROM-decoupling work exists to make
modifying display source worthwhile. Each firmware-touching phase still gets its own
branch + PR; Phase 1 and Phase 3 don't touch `firmwares/motor/tsdz2/src/` at all, so neither needed one.

### Phase 1: Configurator replacement (complete)

Ships value against the firmware exactly as it exists today. Fully supersedes the Java
tool and its native/libusb prerequisites. **No firmware changes, no branch needed.**

1. **Keyed config editor.** New `tools/web_configurator/` folder, static web page.
   Fully supersedes the Java tool's editing role. Pure static page — no local backend
   process. You still run `make` yourself (same as `compile_and_flash_20.sh` does
   today) to turn the generated `config.h` into a `.hex`; that native SDCC dependency
   doesn't go away in this phase.

   **Stack:** Vite + TypeScript, no UI framework (React/Vue etc.) — this is a finite,
   form-heavy app, a framework would be pure overhead. `npm run dev` serves it on
   `localhost` per the earlier serving decision. `npm run build` produces static
   output if it's ever hosted, though hosting isn't planned (see Architecture
   decisions above).

   **Legacy `.ini` import — read-only, one-way.** The tool reads an existing `.ini`
   file and converts it to the new format; it never writes `.ini` back out (see the
   new non-goal above). Old `.ini` files and the Java tool are never touched or
   overwritten by anything this tool does.

   The exact field list, order, types, and backward-compatibility defaults are
   **not to be re-derived from `config.h` or guessed** — `config.h`'s constant order
   doesn't match the `.ini`'s line order. The ground truth is the Java tool's own
   parser: `tools/Java_Configurator_Source/src/TSDZ2_Configurator.java`,
   `loadSettings()`, lines 206-449. It's a plain positional read — one
   `in.readLine()` per line of the file, in a fixed order, parsed as
   `Boolean.parseBoolean(...)`, `Integer.parseInt(...)`, or a raw string depending on
   the field. Cross-check against the writer (`pWriter`/`iWriter` block starting
   around line 1431) to confirm the two stay in the same order — they should, since
   one round-trips the other today.

   That function also already implements a **backward-compatibility scheme worth
   preserving exactly**: newer fields were appended to the end over time as
   `strLine = in.readLine(); if (strLine != null) { ...parse... } else { ...default...
   }` blocks (see lines 350-449 for five such tail groups: display/eMTB/smooth-start
   fields, PWM-frequency fields, TSDZ8 flag, EKD01/assist-level-5 fields, boost-at-zero
   flag, battery-pack-resistance field, torque-modes-based-on-power fields). An older,
   shorter `.ini` file simply runs out of lines partway through and everything from
   that point on falls back to the Java-source-defined default. The new importer must
   reproduce this: treat those same six trailing groups as optional, defaulted blocks,
   not required fields, so old `.ini` files from any point in this project's history
   still import cleanly.

   Building the schema is mechanical: walk `loadSettings()` top to bottom, emit one
   schema entry per `in.readLine()` call (field key derived from the Java
   variable/control name, e.g. `TF_BATT_CUR_MAX` -> `battCurMax`; type from how it's
   parsed; default from the corresponding `else` branch where one exists). This schema
   *is* the new file format's shape — no separate `config.h`-symbol mapping is needed
   for phase 1, since this phase doesn't touch EEPROM or generate anything beyond
   `config.h` text (which the existing `pWriter` logic already shows how to produce
   per field).

   **New format:** save as `<name>.tsdz2.json` (double extension — stays recognizable
   as plain JSON to any editor/tool, but distinct from a generic `.json` at a glance).
   Always a "Save As" to a new file, never an in-place overwrite of the imported
   `.ini`. Top-level shape: `{ "formatVersion": 1, "sourceImport": "<original
   filename or null if created fresh>", "fields": { <schema-keyed values> } }`. The
   `formatVersion` field is this tool's own forward-compat mechanism, independent of
   the (later, phase-4-only) EEPROM schema-version byte.

   **Acceptance check:** the repo already has real fixture data for this — every file
   under `settings/experimental/` and `settings/proven/` (e.g.
   `settings/proven/Default_Settings_TSDZ2_48V.ini`, 161 lines, no trailing groups
   present) is a real `.ini` this importer must parse without error and without
   silently misreading a field. Use them as the import test fixtures instead of
   inventing synthetic ones.

   Also fixes the known Java-tool quirks while building this fresh: no hidden/dead
   controls (e.g. the permanently-`setVisible(false)` startup-assist-speed-limit
   checkbox), and every field that has a real default gets it surfaced in the UI
   instead of silently applied.
2. **`stm8flash`-to-WASM port + WebUSB flashing.** Vendor upstream `stm8flash` C source
   as a git submodule, compile with Emscripten, replace its libusb calls with a WebUSB
   shim (see Architecture decisions above). Flash the `.hex` from phase 1's `make`
   straight from the browser — desktop Chrome (wired ST-Link) or Android Chrome
   (USB-OTG), same code path. Removes the native `stm8flash.exe`/libusb dependency
   entirely; the only remaining native prerequisite after phase 1 is SDCC itself, for
   the `config.h` → `.hex` compile.

At the end of phase 1: prerequisites are Node/npm (dev-time only) + a Chromium browser
+ SDCC (still, for compiling firmware). Java, the native `stm8flash` binary, libusb, and
ST Visual Programmer (already optional today, per the README) are all gone.

### Phase 2: Tuning firmware (ongoing)

Real-world bike tuning, robustness fixes, and upstream-fork integration, driven by
actually flashing and riding two real bikes — not tooling, not a firmware rewrite,
just the continuous work of making the firmware behave correctly and feel right on
real hardware. **By nature this phase never reaches "complete"** — it's the ongoing
counterpart to Phases 1/3 (tooling, shipped) and Phase 4 (a deferred rewrite): as long
as this fork is actively ridden and tuned, this phase keeps accumulating entries.
Everything below was previously grouped under a section called "Fork-specific firmware
behavior changes" — same content, now explicitly named as its own phase per the
5-phase restructure.

- **Cruise control override for walk assist SPORT/TURBO (2026-08-13).**
  Superseded an earlier approach (hacking walk assist's own current/speed caps to make
  it behave like a crude cruise control - tried, reverted the same day) once real-ride
  testing showed walk assist's control loop (`apply_walk_assist()`) always restarts a
  multi-second calibration from scratch on every button press, including a brief
  current *decrement* if already moving above ~4.2 km/h - unsuitable for "engage while
  already at speed."

  `apply_cruise()`'s PID controller is a much better fit (seeds its integral to 500
  specifically so it doesn't dip on engage) but is normally reached only by switching
  `ui8_riding_mode` to `CRUISE_MODE` via a hidden lights-button menu that DZ40 can't
  reach. Two new independent config.h flags, `CRUISE_OVERRIDE_WALK_SPORT_ENABLED` /
  `CRUISE_OVERRIDE_WALK_TURBO_ENABLED` (web configurator: "Override Walk assist
  SPORT/TURBO with Cruise control", inside the "Cruise target speed" card), let the
  walk-assist button borrow Cruise's PID at those two levels specifically - ECO/TOUR
  are untouched, still plain walk assist. (This was the original 2026-08-13 scope;
  extended to all four levels the next day - see the entry below.)

  Mechanism (`ebike_app.c`'s button-capture block, `uart_receive_package()`): when the
  walk-assist button is held and `CRUISE_OVERRIDE_ACTIVE_LEVEL(ui8_assist_level_before_walk_button)`
  is true (`main.h` - folds to compile-time-false dead code when neither override is
  configured), `ui8_riding_mode` is temporarily swapped to `CRUISE_MODE` (save/restore
  via `ui8_riding_mode_temp`, mirroring walk assist's own existing pattern exactly) and
  `ui8_cruise_button_flag` is set, satisfying `apply_cruise()`'s existing
  pedaling-optional engage condition unmodified - target speed comes from
  `CRUISE_TARGET_SPEED_LEVEL_3`/`_4` (`cruiseSpeed3`/`4`), not `WALK_ASSIST_LEVEL_3`/`_4`.
  `apply_cruise()` itself needed zero changes. `walkSpeed3`/`walkSpeed4` are greyed out
  (not hidden) in the UI when their override is on, matching their raw config.h values
  still being emitted but never read at runtime for that level once overridden.

  **Safety guard:** `apply_cruise()`'s entire body is wrapped in `#if CRUISE_MODE_ENABLED`
  - if that's off while an override still fired, `CRUISE_MODE` would have zero logic
  driving `ui8_duty_cycle_target`. `main.h` has a compile-time `#error` if either
  override macro is on while `CRUISE_MODE_ENABLED` is off, so this is impossible to
  reach even via a hand-edited `config.h`, not just prevented by the UI's own
  `dependsOn` gating. Verified via the in-browser build pipeline
  (`tools/web_configurator/src/sdcc-build.ts`'s `preprocess()`) that this guard
  actually fires on the invalid combination and that a valid build (both overrides on,
  Cruise enabled) compiles and links cleanly through the real SDCC/mcpp/sdld chain.

  **UI note:** `CRUISE_OVERRIDE_ACTIVE_LEVEL(level)` is a **single-line** macro,
  deliberately not backslash-continued across multiple lines - no other macro in this
  codebase uses that style, and a first attempt at a multi-line version silently failed
  to expand under the in-browser WASM mcpp preprocessor (SDCC then saw a call to an
  undeclared function: "too many parameters"). Also: while debugging that, discovered
  the running Vite dev server's `import.meta.glob`-sourced firmware source snapshot
  (`sdcc-build.ts`'s `firmwareCH`) can go stale relative to what's actually on disk
  across a long-lived dev server process - a plain page reload didn't pick up edited
  `firmwares/motor/tsdz2/src/*.c`/`*.h` files, only a full dev-server restart did. Worth remembering if an
  in-browser build ever behaves like it's compiling old source.

  **Three real bugs found only by flashing and riding/bench-testing (2026-08-13),
  all now fixed** - "the in-browser build compiles" only proves the C is *syntactically*
  valid, not that the state machine is *correct*; all three are `ebike_app.c` static-
  variable/multi-poll logic bugs the build pipeline can't catch:

  1. **Latch**: a pre-existing `else if (ui8_riding_mode == CRUISE_MODE)` branch (for
     displays with Cruise set as a *permanent* riding mode, unrelated to this feature)
     matched as soon as the override entered `CRUISE_MODE` too, and - being earlier in
     the `else if` chain - shadowed the override's own button-release-restore branch on
     every poll after the first. Releasing the button then did nothing: the rider stayed
     stuck in `CRUISE_MODE` with no path back except a display reboot. Fixed by gating
     that legacy branch on `!ui8_cruise_override_flag`.
  2. **Wrong-level targeting**: DZ40/VLCD5 displays report a *decremented* assist level
     while the shared walk-assist button is held (the reason `ui8_assist_level_before_walk_button`
     exists at all - walk assist's own trigger already special-cases it). Two spots in
     the cruise path still read the live `ui8_assist_level`: `apply_cruise()`'s PID
     target-speed lookup, and the `ui8_riding_mode_parameter` assignment that also feeds
     `ebike_control_motor()`'s master safety cutoff (zeroes duty cycle/current entirely
     if that parameter is 0). Fixed both to use the pre-button level whenever
     `ui8_cruise_override_flag` is set.
  3. **PID never initializes on first engagement**: `apply_cruise()` only (re)initializes
     its PID - and only then sets `ui16_wheel_speed_target_x10`, the actual target speed -
     on a poll where `ui8_cruise_PID_initialize` was already 1, normally seeded by a few
     naturally-disengaged polls before organic (menu-selected) cruise use ever really
     engages. The override can satisfy its engage condition on its very first poll ever,
     skipping that warm-up entirely - target speed stays 0 forever, PID output clamps to
     0, motor produces no output at all. Matched the "AW activated, not even a whimper"
     symptom exactly. Fixed by explicitly setting `ui8_cruise_PID_initialize = 1` at the
     same point `ui8_cruise_override_flag` is set.

  Commits: `cd34d5c` (latch), `c25bb9d` (wrong-level), `1d4905d` (PID init).

- **Extended the override to all four levels, individually toggleable
  (2026-08-14).** Originally SPORT/TURBO only ("might as well have all of them
  there, and the user can selectively choose which ones (if any) to
  override" - user request). Two new config.h flags,
  `CRUISE_OVERRIDE_WALK_ECO_ENABLED` / `CRUISE_OVERRIDE_WALK_TOUR_ENABLED`
  (web configurator: "Override Walk assist ECO/TOUR with Cruise control",
  same "Cruise target speed" card as the original two), mirroring
  SPORT/TURBO's exactly. `main.h`'s `CRUISE_OVERRIDE_ACTIVE_LEVEL(level)`
  macro and its `#error` guard both extended to OR in all four
  `CRUISE_OVERRIDE_WALK_*_ENABLED` flags instead of just two -
  `ebike_app.c`'s actual control-flow code needed **zero** changes, since it
  already only ever calls `CRUISE_OVERRIDE_ACTIVE_LEVEL(...)` generically
  (comments there updated from "SPORT/TURBO" to "any level" for accuracy,
  but no logic changed). Each level has its own independent macro/checkbox -
  none of the four require any of the others, so e.g. ECO-only or
  SPORT+ECO-but-not-TOUR/TURBO are both valid configs.

  Web configurator wiring (all mechanical, following the exact pattern
  SPORT/TURBO already established): two new tail-group-9 schema.ts fields
  (`cruiseOverrideEco`/`cruiseOverrideTour` - a new tail group, not appended
  to tail group 8, so a `.tsdz2.json`/`.ini` saved before this addition,
  which already has tail group 8's 2 lines, doesn't come up short); two new
  `config-h-generator.ts` `define()` calls; two new `ui-model.ts` control
  definitions with `hint`s identical in structure to SPORT/TURBO's; `main.ts`'s
  `EXTRA_CELL_ENABLED` (per-cell grey-out inside the "Walk assist speed"
  4-cell card) and the `groupSectionControls` extras-detection (now expects
  4 contiguous override checkboxes after `cruiseSpeed4`, not 2) both
  extended from 2 to 4; the checkbox handler's cruiseWithoutPedaling
  auto-enable side effect extended to all 4 keys. `walkSpeed1`/`walkSpeed2`
  (ECO/TOUR walk-assist speed) tooltips gained the same "has no effect while
  override is on" line `walkSpeed3`/`walkSpeed4` already had.
  `settings/proven/Default_Settings_TSDZ2_48V.ini` (the "Reset to defaults"
  source, see below) padded with 2 more `false` lines to stay the "fully
  populated, zero warnings" fixture `ini-format-lock.test.ts` relies on.

  Also documented (help text, not new logic - already correct in the
  underlying firmware) that disabling "Walk assist enabled" does **not**
  disable any of the four overrides: the override check in `ebike_app.c`
  lives outside the `#if ENABLE_WALK_ASSIST` block entirely, gated only on
  `CRUISE_MODE_ENABLED`/its own macro. Confusing without an explanation,
  since it means the button still does something with "Walk assist" off.

  **Test coverage**: `tests/test_cruise_override.py` gained a second
  compiled module fixture, `ebike_all_levels` (all four overrides on,
  alongside the original `ebike` which stays SPORT/TURBO-only so the
  original bug-regression tests keep their original meaning), plus:
  parametrized versions of the engage/target-speed/release tests run across
  all 4 levels (12 tests) - genuinely exercises `main.h`'s extended
  `CRUISE_OVERRIDE_ACTIVE_LEVEL` macro through real compilation, not just
  code review, and would have caught e.g. a copy-paste mistake wiring ECO to
  TOUR's macro; and one dedicated test proving the four toggles are
  independent (`ebike`'s SPORT/TURBO-only config still leaves ECO/TOUR as
  plain walk assist). 160 tests total (was 147). Verified via the
  in-browser build pipeline with both the real on-bike config (SPORT/TURBO
  only, unaffected) and a variant with all four overrides on - both compile
  and link cleanly.

- **Pre-flight verification for firmware logic: STM8-Emulator rejected, native
  pytest/cffi harness extended instead (2026-08-13).** After the three bugs above, user
  asked to look into https://github.com/mikechambers84/STM8-Emulator as a way to catch
  this class of bug *before* flashing.

  **Rejected** after cloning and reading its source (not just the README): it doesn't
  support STM8S105 (only STM8S003F3/207S6/207R8 - same "medium density" family, but not
  a supported target), and critically doesn't emulate `TIM1` (motor PWM) or `UART2`
  (the display protocol - the thing that fills `ui8_rx_buffer`, where all three bugs
  above actually lived) at all - both only show up as clock-gate stub bits in `clk.c`.
  It does have a real headless CLI (`-hex`/`-elf`/`-ramdump`, not GUI-only), but with no
  UART2 emulation there's no way to feed it a synthetic display packet through the
  normal path. Windows-only prebuilt `.exe`; the GPL C++ source (VS2019, no CMake) would
  need real work - implementing UART2 and TIM1 from scratch - to be usable here.
  Repo was cloned to inspect, then deleted per instruction; nothing from it is in this
  repo.

  **What was used instead**: this repo already carries a native C test harness inherited
  from upstream (`tests/` + `pyproject.toml`, `tests/load_c_code.py`) - CFFI compiles
  `firmwares/motor/tsdz2/src/*.c` **unmodified** as one combined translation unit and exposes it to pytest as
  `sim._tsdz2`. The `static`-function problem (`uart_receive_package()`, `apply_cruise()`,
  `ebike_control_motor()` are all `static` in `ebike_app.c`) turns out to be a non-issue:
  cffi's generated glue code takes `&function_name` directly from *within* the same
  translation unit, so C's static/internal-linkage restriction (which only blocks
  cross-TU symbol resolution) never applies. `test_diag.py` already proved this works by
  calling `ebike.uart_receive_package()` directly. All three bugs above are exactly the
  kind of thing this harness can pin down with a regression test: synthesize a UART
  packet into `ui8_rx_buffer`, call the real button-handling function, assert on the
  resulting static state - no CPU/peripheral emulation needed for logic like this.

  It didn't work out of the box; three real problems found and fixed getting it running
  again, all worth remembering:

  1. **`pycparser` 3.0 breaks it.** `load_c_code.py` imports `pycparser.plyparser`,
     which pycparser 3.0 removed/renamed. `pyproject.toml` never pinned pycparser (only
     a transitive `cffi` dependency), so a fresh install silently resolves to 3.0 and
     `tests/conftest.py` fails to import with no obvious cause. Fixed: pinned
     `pycparser <3.0` in `pyproject.toml` (resolves to 2.23).
  2. **The checked-in `firmwares/motor/tsdz2/src/config.h` predates this feature.** It's a real, git-tracked
     reference config (kept in sync with actual fork defaults over time, not vestigial),
     and didn't define `CRUISE_OVERRIDE_WALK_SPORT_ENABLED`/`_TURBO_ENABLED` at all. Since
     `CRUISE_OVERRIDE_ACTIVE_LEVEL(level)` (`main.h`) uses them unconditionally in
     `ebike_app.c`, not just inside an `#if`, this isn't a "defaults to disabled" gap -
     it's a hard compile error ("undeclared identifier") for **any** config.h that
     predates the feature, including a plain native `make` build with an old/hand-edited
     config.h, independent of the Python harness. Fixed: added both macros (`0`, i.e.
     off) to `firmwares/motor/tsdz2/src/config.h`, matching what `config-h-generator.ts` always emits - this
     is a *separate, static reference file* only used by native `make`/this Python
     harness, not by the web configurator (which already generates these macros
     correctly on every build; nothing there needed to change).
  3. **`uart_receive_package()` really does touch real hardware.** Near its end it
     re-enables the UART2 RX interrupt with `UART2->CR2 |= (1 << 5)` - a genuine register
     write through `UART2`, a `stm8s_uart2.h` macro for a fixed low STM8 memory address.
     Dereferencing that natively segfaults immediately (confirmed via `gdb -batch -ex run
     -ex bt`, pinpointing the exact line). `test_diag.py`'s existing test never noticed
     because it never sets `ui8_received_package_flag`, so it skips the whole guarded
     block this line lives in - but any test exercising the button/checksum path (i.e.
     this one) hits it. Not fixable in `ebike_app.c` (it's correct, real firmware
     behavior) and not worth stubbing all of `stm8s_uart2.h`: the new tests append a
     small `#undef UART2` / `#define UART2 (&some_static_struct)` snippet to their own
     **scratch copy** of `config.h` (see below), redirecting the macro at ordinary
     process memory. Safe because the tests bypass UART2 entirely anyway, writing
     directly to `ui8_rx_buffer` rather than simulating real received bytes.

  **New file: `tests/test_cruise_override.py`.** The stock `firmwares/motor/tsdz2/src/config.h` ships with the
  override off, and `load_c_code.py`'s compiled module is a single global keyed only by
  `module_name` (built once per session from module-level `source_dirs`/`include_dirs`
  globals) - so exercising the feature needs a *different* config than every other test
  file gets, without permanently flipping the checked-in reference config.h. The `ebike`
  fixture handles this itself: copies `firmwares/motor/tsdz2/src/*.c`/`*.h` (top-level only) into a `tempfile`
  scratch dir, patches specific `#define` lines in the copied `config.h` (cruise
  enabled, both overrides enabled, `cruiseWithoutPedaling` on, threshold 0 - matching
  the real on-bike config) plus the `UART2` redirect above, then temporarily repoints
  `load_c_code`'s module-level dirs at the scratch copy for one
  `load_code("_tsdz2_cruise", force_recompile=True)` call before restoring them - so the
  default `sim._tsdz2` module every other test file uses, built against the real
  `firmwares/motor/tsdz2/src/`, is untouched. Five tests, one per bug above plus a control (ECO/TOUR walk
  assist must stay untouched by the override).

  **Verified these are real regression tests, not vacuous ones**: for each of the three
  bug fixes, temporarily `git apply -R`'d just that commit's `firmwares/motor/tsdz2/src/ebike_app.c` hunk,
  confirmed the matching test failed, then restored it and confirmed the suite was clean
  again. All three failed exactly as expected when their fix was reverted.

  **Pre-existing, unrelated test rot found along the way - fixed 2026-08-14**:
  `tests/test_wheel_speed.py`, `tests/test_diag.py`, and `tests/test_speed_limit.py` were
  21 failed / 13 errored, all pre-existing and unrelated to the cruise-override work.
  Two root causes: (1) stale variable names - `test_diag.py` referenced
  `ui16_battery_voltage_filtered_x1000` (doesn't exist; real name/scale is
  `ui16_battery_voltage_filtered_x10`, e.g. 48V is `480` not `48000`) and
  `test_speed_limit.py` read/wrote `m_configuration_variables.ui8_wheel_speed_max`,
  which actually lives on `ebike_app.c`'s file-scope `ui8_wheel_speed_max`, not inside
  `m_configuration_variables`; (2) `test_wheel_speed.py`'s hardcoded expected speeds and
  its own `MOTOR_TASK_FREQ` reference constant were computed for `PWM_FREQ=19`
  (`PWM_COUNTER_MAX=420`), but checked-in `firmwares/motor/tsdz2/src/config.h` defaults to `PWM_FREQ=18`
  (`PWM_COUNTER_MAX=444`) - a genuine firmware-default change the tests never caught up
  to, not a naming bug. Recomputed against `calc_wheel_speed()`'s real formula; see
  `tests/test_wheel_speed.py`'s comments for the derivation and a note to recompute again
  if `PWM_FREQ`'s default ever changes. Full suite (147 tests) now passes.

- **Dead "Street-mode power limit enabled" toggle removed from the web configurator
  (2026-08-15, commit `b14518c`).** `firmwares/motor/tsdz2/src/` has no `#if` on `STREET_MODE_POWER_LIMIT_ENABLED`
  anywhere - the checkbox never had any effect on compiled firmware. `STREET_MODE_POWER_LIMIT`
  itself applies unconditionally whenever street mode is on, regardless of this macro's value.
  Worse, the checkbox defaulted to `false`, which hid the always-active Street-mode power
  limit *field* from a fresh profile via its own `dependsOn` - so a rider relying on the
  checkbox's apparent "off" state to mean no limit was actually still getting one, silently.
  Removed the control from the web configurator (joins the existing dead-field list alongside
  `streetThrottleEnabled_UNUSED`/`throttleLegal_UNUSED`/`motorTypeTSDZ8`), made Street-mode
  power limit always visible, and hardcoded the generated `config.h` macro to `1` so it stops
  claiming "disabled" for a limit that's actually always live. The raw field stays in
  `schema.ts` for old `.ini`/`.tsdz2.json` round-tripping - only the UI control was removed.

- **Battery-sag detection: smoothed undervoltage ramp-down + E11 indicator (2026-08-15).**
  Motivated by a real ride finding: `motor.c`'s undervoltage ramp-down check (`motor.c:813`)
  compared a raw, single-sample ADC voltage read every PWM cycle against the configured
  cutoff - under Cruise's sustained current draw on a partly-depleted pack, this could trip
  repeatedly and make Cruise feel weak/inconsistent late in a ride, with zero visibility
  into why (no fault code - that check is silent by design, unlike the much lower, separate
  hard-shutdown threshold which does surface E01).

  `filter_undervoltage_check_voltage()` (`motor.c`) now smooths the reading before the
  ramp-down reacts to it, tunable via `BATTERY_VOLTAGE_SAG_FILTER_SHIFT` (web configurator:
  "Battery voltage sag filter", default 10 / ~57ms time constant at the 18kHz/55.5us PWM
  period, max 15 / ~1.8s - higher risks real pack over-discharge, hence the cap; shift=0
  reproduces the original unsmoothed behavior exactly). A same-resolution accumulator was
  tried first and found - via its own regression test, before ever reaching a flash - to
  permanently stall at 0 for any realistic 10-bit ADC voltage once the shift reached 10
  (`raw >> 10` is 0 for every value below 1024, i.e. every real reading), which would have
  meant the ramp-down was *always* active - not weak Cruise, but the motor never spinning
  up at all. Fixed with a wider (`uint32_t`) fixed-point accumulator that accumulates the
  full-precision raw sample every cycle and only shifts down to the 16-bit output at read
  time - the standard integer-EMA pattern, and immune to the same collapse.

  `check_battery_sag_indicator()` (`ebike_app.c`) surfaces a new, distinct fault code
  (`ERROR_BATTERY_SAG`, E11 - deliberately not reusing E01, which is tied to a real,
  reboot-required hard shutdown and would have been misleading for a benign, self-clearing
  condition) whenever the ramp-down is actively throttling power. Purely informational,
  never overrides a real fault, toggleable independently of the filter (web configurator:
  "Battery sag indicator", default on) since it only controls what's shown on the display,
  not the underlying protection - filter=0 and indicator=off together reproduce pre-change
  behavior exactly on both counts.

  New `tests/test_battery_sag.py` (11 cases) covers the filter convergence/smoothing math
  (pinned to a scratch shift=2 module, independent of whatever the real default gets tuned
  to later), the E11 trigger/priority/boundary logic, and scratch-config coverage proving
  both toggles genuinely compile their feature out when off - including the regression test
  for the resolution-collapse bug above, using the actual shipped default.

- **Merged dzid26/TSDZ2-Smart-EBike's `firmwares/motor/tsdz2/src/` improvements (2026-08-18).** While investigating
  GitHub forks for anything useful ahead of the rider's 860C/OSF torque-calibration purchase,
  found [dzid26/TSDZ2-Smart-EBike](https://github.com/dzid26/TSDZ2-Smart-EBike) - the only
  genuinely active fork out of ~50 checked (2 stars, pushed 2026-06-25, 38 commits ahead of
  current `emmebrusa/TSDZ2-Smart-EBike-1` master with 0 behind, i.e. a clean superset - not
  stale). Real firmware engineering, not config tuning: motor overrun mitigation (detects the
  motor spinning faster than the pedals - gear slipping, pedals stopping, mid-shift - and cuts
  duty quickly instead of over-driving the drivetrain), smoother startup torque ramp
  ("pedal-sync" duty target), a wheel-speed E08 fault-accumulation bug fix, cadence/wheel-speed
  math rewrites (calc'd 4x more often, decaying-counter simplification, correct clamp-to-0 at a
  stale/stopped reading instead of wrapping to a small bogus nonzero value), `__divulong`
  removal for code size, C23 support, cppcheck static-analysis CI, and a sweep of `main.h`
  `static_assert`s sanity-checking most of `config.h`. Confirmed zero new user-configurable
  `config.h` fields anywhere in the 38 commits (`git diff` on `firmwares/motor/tsdz2/src/config.h` between the shared
  ancestor and dzid26's tip is empty) - every new `#define` is a fixed engineering constant
  derived from *existing* config values (hall/cadence-magnet geometry, motor pole-pair counts,
  BEMF/phase-resistance physics per motor voltage variant, wheel-speed sanity limits), so
  **nothing here needed a matching web configurator change** - unlike this fork's own features,
  none of dzid26's additions are behind a toggle.

  **Landed via a full history rebase, not a cherry-pick or squash** (`git rebase --onto
  dzid26/master 2c944f1 master`, replaying this fork's 161 commits since the shared ancestor
  onto dzid26's tree) specifically so both sides' original commits/authorship stay intact and
  individually visible in `git log`, rather than collapsing dzid26's work into one anonymous
  merge commit. 620 of this fork's own commits + 38 of dzid26's = 658 total. Verified clean
  first via a disposable 9-commit cherry-pick of just this fork's real `firmwares/motor/tsdz2/src/` logic (walk-assist
  PAS-level fix, the full cruise-override series, battery-sag detection) onto dzid26's tree -
  only 2 real conflicts, both trivial to reason about - before committing to the full rebase.
  Both recurred identically in the full rebase (rerere-recorded resolutions applied
  automatically):

  1. **`firmwares/motor/tsdz2/src/motor.c`'s duty-cycle-decrease condition list** - dzid26's overrun check and this
     fork's `ui16_adc_voltage_filtered` (battery-sag smoothing) both touch the same `if (...)
     { ramp down }` condition. Resolved by keeping both: dzid26's `overrun && (...)` term plus
     the filtered-voltage swap, neither feature lost.
  2. **`firmwares/motor/tsdz2/src/config.h`'s `CRUISE_MODE_ENABLED` region** - this fork's cruise-override commits and
     dzid26's own history both touch adjacent lines there; resolved by keeping this fork's flag
     value alongside dzid26's neighboring lines.

  Also caught two second-order issues once the merged tree was actually run through the real
  test suite (not just checked for textual conflicts) - both real, both fixed:

  - **A genuine design conflict, not a bug**: dzid26's `static_assert(CRUISE_THRESHOLD_SPEED >
    0)` (part of a blanket sanity-check sweep across `config.h`, not a targeted fix - the commit
    touches ~15 unrelated fields the same way) is incompatible with this fork's own
    cruise-control-override-for-walk-assist feature, which requires `CRUISE_THRESHOLD_SPEED=0`
    to let the override engage from a dead stop (`CRUISE_MODE_WALK_ENABLED`'s branch in
    `apply_cruise()`) - confirmed both via the regression test's fixture (deliberately simulates
    0 km/h) and this fork's own real, currently-flashed settings
    (`settings/experimental/TSDZ2B-48V-500W-20260816-22A.tsdz2.json` ships `cruiseThresholdSpeed:
    0`). dzid26's fork never exercises `CRUISE_MODE_WALK_ENABLED` (the field predates both
    forks, inherited unused from the shared ancestor), so the assertion was written without
    visibility into a feature it now conflicts with, not in spite of it. Scoped the assertion to
    `#if !CRUISE_MODE_WALK_ENABLED` (`firmwares/motor/tsdz2/src/main.h`) rather than weakening either side.
  - `tests/test_wheel_speed.py`'s `ticks=65535` case expected the old wraparound value (20) -
    stale against dzid26's intentional clamp-to-0 fix above; updated the expectation and comment
    to match the new, correct behavior.

  Full pytest suite (182 tests) passes clean on the merged tree, matching the pre-merge pass
  rate exactly (the one remaining failure, `test_filter.py::test_filter`, is a pre-existing
  hypothesis-framework edge case that fails identically on unmodified pre-merge `master` -
  confirmed unrelated, left alone).

  **A fourth, more serious issue slipped past all of the above and reached the pushed
  `master` briefly**: dzid26's static_assert sweep uses C23's single-argument
  `static_assert(expr);` form, which compiles fine under the native `gcc -std=c2x` the
  Python test harness uses, but broke the *real* firmware build outright - the very first
  assert in `main.h` was a hard syntax error there. Neither the native pytest suite nor
  the web configurator's own TS-only test/lint/e2e suites build `firmwares/motor/tsdz2/src/` through SDCC at
  all, so none of them could have caught this - only actually running a real in-browser
  build (Playwright driving the app: import a real settings fixture, click Build, confirm
  success) surfaced it, after the fact, once asked directly whether the merge had been
  exercised end-to-end. Fixed by converting all 120 asserts to the more portable C11
  `_Static_assert(expr, "message")` form (semantically identical, using each assert's own
  trailing comment as the message) - kept even after the real root cause below was found,
  since it's unconditionally valid regardless of `--std-` flags anywhere in the toolchain.

  **Root cause, found after initially assuming an SDCC limitation (wrong first guess -
  corrected here)**: SDCC's own grammar (`vendor/sdcc/src/SDCC.y`) and lexer
  (`SDCC.lex`) *do* fully support C23's single-argument `static_assert(expr);` - the
  lowercase spelling is keyword-recognized precisely when `options.std_c23` is set
  (`TKEYWORD2X`), proven by reverting the `_Static_assert` conversion and testing against
  a real in-browser build again: it built clean. The actual bug was
  `tools/web_configurator/src/sdcc-build.ts`'s own hardcoded `CFLAGS` constant - its
  comment claims "Matches `firmwares/motor/tsdz2/src/Makefile`'s CFLAGS" but still said `--std-c99`, never
  updated when this fork's own Makefile-conflict resolution (during the dzid26 rebase,
  same session) bumped the real `firmwares/motor/tsdz2/src/Makefile` to `--std-c23` (dzid26's own C23-support
  commit). Under `--std-c99`, `static_assert` isn't a keyword at all - just an
  undeclared-identifier, hence the syntax error at the following `(`. Fixed by syncing
  `sdcc-build.ts`'s `CFLAGS` to `--std-c23` too, closing the gap the comment already
  promised was closed. **Answering "do we lose anything without full C23 support":
  nothing - SDCC's C23 support is real and now correctly wired into the in-browser build
  path; the `_Static_assert` conversion was never load-bearing for that, just a more
  defensive spelling kept for its own sake.**

  Lesson for any future upstream merge: **build it for real, not just
  typecheck/lint/pytest** - this fork's actual deliverable is SDCC-compiled STM8 output,
  and nothing else in the test pyramid exercises that compiler.

### Phase 3: Display firmware flashing (shipped, hardware verification pending)

Extends the web configurator (Phase 1's tool) to flash the 860C/850C and SW102 display
firmwares over SWD, using the same ST-Link already used for the motor's SWIM flashing.
Added 2026-08-18, beyond the tool's original motor-only scope. Same underlying idea as
Phase 1's item 2 (vendor a real upstream flashing tool, compile to WASM, WebUSB shim)
applied to a different debug protocol and different chip families.

- **860C/850C (STM32F103):** vendors [stlink-org/stlink](https://github.com/stlink-org/stlink),
  reusing its real FPEC flash algorithm and STM32 chip-ID table directly.
- **SW102 (nRF51822):** stlink-org has zero Nordic chip support (confirmed by
  inspecting its `config/chips/` directory - STM32-only), so this one is a
  from-scratch NVMC register-sequence implementation, built on stlink-org's
  chip-agnostic `stlink_read_debug32()`/`stlink_write_debug32()` primitives rather
  than a second vendored project.
- **Flashing only, not building** - these display firmwares run unmodified for now.
  In-browser building is Phase 5 (below), deferred until there's real reason to modify
  display source - which itself is expected to arrive via Phase 4's plan to rework the
  displays to read config from EEPROM instead of talking live to the motor.
- The one genuinely hard implementation problem (stlink-org's real USB device
  enumeration doesn't make sense when WebUSB already picked one specific,
  permissioned device) was solved by faking the enumeration at the libusb-shim
  layer rather than patching or duplicating stlink-org's own code - full writeup,
  including the CMake-bypass gotchas, in `tools/CLAUDE.md`.
- **Not yet verified against real 860C/850C/SW102 hardware** as of this writing -
  everything short of that (build, link, module load, UI wiring, fake-enumeration
  protocol path) is verified; only an actual flash-and-boot test remains. This is
  the one thing standing between "shipped" and "done" for this phase.
- **Found 2026-08-19, resolved: 860C's SWD pins aren't practically accessible, and
  the real UART-bootloader protocol is already fully reverse-engineered and
  hardware-verified - just not yet ported into this repo.** Read eco-ebike.com's
  own "860C Display Bootloader for Firmware Programming" instructions
  (Wayback-archived copy of their site, not linked/copied into this repo -
  third-party commercial content, not ours to redistribute). Their real-world
  flashing method is a UART serial bootloader through the **same 5-pin HIGO
  mini-B connector that normally talks to the TSDZ2 motor** (green = UART TX,
  white = UART RX, black = GND, 3.3V logic - wiring per the OpenSourceEBike
  wiki), not a separate flash header - programming mode is entered by a short
  press of the remote's power button while a Windows tool is armed and waiting.
  Display power (separate from the UART itself) needs 27-35V, from the ebike
  battery or a step-up/booster board off USB 5V. They also warn **850C is
  unreliable this way** ("changes in hardware often cause failure of OSF loading
  and 'brick' the display").

  The OpenSourceEBike wiki independently confirms *why* everyone uses UART:
  "what seems to be the JTAG SWD pins on the board are on the bottom side of the
  display, meaning it is not possible to make a hole in the enclosure to access
  them" and "there is no way to open this display without damaging it mostly."
  So the already-shipped SWD-based flasher (`flashStm32Hex`, this phase's
  original approach) is likely technically correct but practically unusable on
  real 860C hardware without destructive disassembly.

  **The actual protocol is already reverse-engineered, byte-verified, and
  confirmed to flash-and-boot real hardware** - sitting unmerged-upstream in a
  local `Color_LCD_860C` clone (10 commits ahead of `origin/master`, merged
  2026-08-18 from GitHub user `ramb0t`'s fork, work dated 2026-06-14, done with
  a real logic analyzer against real hardware). Full
  spec: `docs/bootloader-uart-protocol.md`; working reference implementation:
  `tools/flash860c.py` (Python + pyserial - "verified end-to-end as a writer...
  has flashed real 860C firmware... and the display booted").

  Protocol summary: 57600 8N1 (distinct from the 9600-baud runtime
  display-motor traffic). Host polls `0x5A` every ~31ms until the display sends
  `0xA5` (ready, on power-on). Firmware ships as 2060-byte blocks (`magic(2) |
  address_be32(4) | payload(2048) | checksum_be32(4) | 0D0A`), one ACK (`0x85`)
  per block before sending the next, `0x8F` = NAK-and-resend-same-block. Two
  zero-payload `F2F2` terminator blocks end the transfer (not ACKed - the
  display just boots after them). One address quirk that will brick the boot if
  gotten wrong: the block address field is `0x08004000`-based even though the
  app physically loads at `0x08005000` - the bootloader applies a `+0x1000`
  mapping itself (which also doubles as write protection, keeping the protocol
  from ever touching its own 20 KiB bootloader region). Use the `0x4000` field
  base as-is; do not "correct" it to `0x5000`.

  **Ported 2026-08-19: `firmwares/motor/tsdz2/src/uart-transport.ts` (Web Serial connect/disconnect,
  mirroring `usb-transport.ts`'s shape) + `firmwares/motor/tsdz2/src/uart-flasher.ts`
  (`buildBootloaderBlock`/`buildBootloaderBlocks`/`flashUartBin`) implement this
  protocol, wired into `render/display-flash-page.ts`'s 860C/850C/850C_2021 UI as
  the primary flashing path.** Reimplemented from scratch against the documented
  protocol facts above (block layout, addressing, handshake/ACK/NAK/retry
  semantics) rather than ported/transliterated from `flash860c.py` line-for-line -
  `Color_LCD_860C` (and `ramb0t`'s fork of it) carries no LICENSE file, so
  copying its source wasn't a safe option; the wire protocol itself isn't
  copyrightable, so a clean-room TS implementation sidesteps the question
  entirely. `flashStm32Hex` (the SWD path) is deliberately **not** wired into
  this page's UI anymore - untested against real hardware, and its SWD pins
  aren't reachable without opening a sealed case - but stays in
  `display-flasher.ts`, unused, as a possible future advanced/recovery-flashing
  building block, since the UART protocol structurally can never write into its
  own bootloader region (see the `+0x1000` write-protection note above), so SWD
  recovery from a bad UART flash remains possible in principle. Pure block-layout
  logic covered by `firmwares/motor/tsdz2/src/__tests__/uart-flasher.test.ts`; the live handshake/
  ACK-NAK/retry loop against real hardware is **not yet tested** - the 860C
  hasn't arrived yet. SW102 is unaffected by any of this - it still flashes over
  SWD (`flashNrf51Hex`, unchanged), since that's a one-time bootloader+softdevice
  bootstrap on blank hardware, not a repeat/update path; its regular firmware
  updates are Bluetooth DFU (Nordic's `nrfutil dfu ble-native`, confirmed via
  `SW102_LCD/firmware/SW102/README.md`), a third browser transport (Web
  Bluetooth) this page doesn't support yet - not started, no timeline.

### Phase 4: Universal firmware (deferred, contingent)

Everything below is the original firmware-first plan, kept for later. Nothing here is
scheduled; revisit if Phase 1/3's tooling proves out and recompiling-per-tweak is still
annoying enough to justify it. Each of these touches `firmwares/motor/tsdz2/src/` and needs its own branch +
PR. (Formerly numbered "Phase 2" before the 2026-08-18 restructure - same content,
same deferred/contingent status, just renumbered so Phases 2/3's real, shipped work
isn't sandwiched behind it.)

#### Design principle: motor-bus architecture, not a monolith (added 2026-08-29)

The motor and display are already, physically, exactly what an automotive ECU network
is: separate MCUs, separate flash, separately versioned, talking over a wire. What this
fork doesn't have yet is a real *bus protocol* - the actual "each subsystem is its own
plugin" pattern automotive networks use is a properly negotiated interface between
nodes, not literal runtime-loadable code inside any one node. That distinction matters
concretely on this hardware: the STM8S105 (8KB RAM, tens of KB flash, no MMU, no dynamic
linker) cannot do automotive-style hot-swappable ECU firmware modules - there's no
runtime loader to swap into. What it *can* do is compile-time-pluggable components with
clean interface boundaries, which gets most of the same benefit (easy override, easy
testing, independently versioned pieces) without needing infrastructure this chip
doesn't have room for.

Real motivating evidence, not a hypothetical: the 2026-08-28/29 telemetry-extension work
(COMM_FRAME_TYPE_PERIODIC growing 6 bytes) needed a hand-bumped `UART_TX_BUFFER_LEN`
constant on the motor, a matching hand-bumped `UART_NUMBER_DATA_BYTES_TO_RECEIVE` on the
display, and a hardcoded `if (patch >= 53)` literal gate guarding the new field parsing -
three separate places that all have to be kept in lockstep by hand, with no mechanism
that would have caught a mismatch other than careful code review. Real-hardware bring-up
the same night also surfaced a related, adjacent bug this pattern makes easy to miss:
the 860C protocol's periodic-frame power-cap byte (`ebike_app.c`'s
`ui8_target_battery_max_power_div25 = ui8_rx_buffer[6]`) had no independent ceiling check
against the motor's own `TARGET_MAX_BATTERY_POWER` at all, unlike the DZ40/VLCD5 protocol
path (`uart_receive_package()`'s `ui32_adc_battery_power_max_x10_array`) which already
treats the motor's own config as authoritative - two protocols in the same firmware
disagreeing about who owns the ceiling. Both problems are instances of the same root
cause: no real interface contract between the two sides, just parallel hand-maintained
assumptions.

Three concrete, buildable pieces for this phase, in roughly increasing order of effort:

1. **Storage backend as a real interface, not eeprom.c called directly.** A small
   `storage_read(key)` / `storage_write(key, val)` boundary with the STM8's on-chip
   EEPROM as the only implementation today - but a boundary clean enough that the
   `tests/` cffi harness (which already stubs UART2 registers to keep hardware access out
   of native test builds - see this repo's own `CLAUDE.md`) could substitute a second,
   in-memory implementation for fast unit tests, and a future external I2C/SPI EEPROM
   board would be a second real implementation, not a fork of `eeprom.c`.
2. **A real capability-negotiation handshake, replacing fixed version literals.** Instead
   of a display and motor each hardcoding a `major.minor.patch` number and refusing to
   talk on mismatch (today's `MOTOR_INIT_GOT_MOTOR_FIRMWARE_VERSION` gate, `state.c`) or
   silently trusting an unchecked byte (this session's `patch >= 53` gate, and the missing
   power-cap ceiling check above), the motor should advertise what it actually supports
   (which optional fields, which frame variant) and the display should negotiate against
   that - "the bus" being versioned per-capability rather than per-monolithic-release
   number. This is the direct fix for the exact class of bug this session spent hours on.
3. **Display protocols as runtime-dispatched handlers, one flash image** - already
   planned below ("Universal display support"); this principle is *why* that item exists,
   not a separate one. Depends on (2) for the negotiation, not just the dispatch table.

Everything else in this phase (EEPROM schema/versioning, the buckets below) already
follows this same shape - this section exists so the *reason* is written down once,
rather than re-derived per bullet.

- **Groundwork / measurement.** Enable `TIME_DEBUG`, get real loop-timing numbers on
  actual hardware. Pull in the interrupt-driven UART TX fix from PR #144. Confirm the
  STM8S105x6 EEPROM size against the real datasheet (currently an assumed figure).
- **EEPROM schema & safety plumbing (design only).** Define the keyed schema (name,
  address, byte width, encoding, version). Add the schema-version byte + validation.
  Define the signed-offset convention. Classify all 146 `config.h` constants into the
  three buckets above. Document the cross-value safety interlocks that need
  reimplementing later.
- **Power assist's silent halve-before-storage encoding (found 2026-08-12, via
  web_configurator UI work) — normalize this while migrating to EEPROM.** Unlike every
  other assist-type family, `POWER_ASSIST_LEVEL_1..4` in `config.h` are NOT the byte the
  firmware stores/uses: `main.h`'s `POWER_ASSIST_LEVEL_ECO/TOUR/SPORT/TURBO` macros halve
  each one (`(uint8_t)(POWER_ASSIST_LEVEL_1 / 2)`) before it lands in
  `ui8_riding_mode_parameter_array` — so the config value is genuinely a percent (100 =
  100%, safe up to 511; 512+ wraps the uint8_t cast to 0, silently killing that level's
  assist entirely) while Torque/Cadence/eMTB's config values go into the same array
  untouched (plain 0-254/255, no hidden transform). This asymmetry is exactly what led an
  earlier documentation pass in this same session to conclude (incorrectly - see
  `web_configurator/src/ui-model.ts`'s `WIDE_RAW_FIELDS` comment, corrected 2026-08-12)
  that Power's default of 480 "truncates to 224" — it doesn't (480 → 240, no truncation
  at all) — but the fact that this was gotten wrong once by a careful audit is itself
  evidence the encoding is a real footgun, not just a documentation nit: it silently
  breaks the "config value == stored value" assumption every other assist family relies
  on, invites exactly this kind of miscalculation in tooling built against it, and cost
  real time in `web_configurator` to work around (Assist level 5's cross-field math has
  to special-case Power's implicit `/2`, and the UI's own bar-chart scaling/rawMax
  validation had to special-case it too - see `ASSIST_LEVEL_5_ECO_FIELDS`/
  `POWER_ASSIST_LEVEL_FIELDS` in that codebase for the workarounds). Firmware-side fix:
  store the real percent directly (widen to a field that doesn't need the halve, or apply
  the `/50` multiplier math directly to the un-halved value at use time in
  `apply_power_assist`) so Power's config value means what it says without a hidden
  factor-of-2, matching the other three families. Not fixed now — but don't reintroduce
  the same halving convention when this constant moves to EEPROM in this phase; normalize
  it then.
- **Startup assist and Walk assist share one physical button, distinguished only by
  lights on/off (found 2026-08-13, via web_configurator UI work) — reconsider this UX
  during the refactor.** `ebike_app.c` (~line 2773-2800): both modes gate on the exact
  same `ui8_walk_assist_button_pressed && ui8_startup_flag` condition; which one actually
  activates is decided purely by `ui8_lights_flag` (Startup assist wins when lights are
  ON, Walk assist when they're OFF), not by anything the rider deliberately picks in the
  moment. `apply_startup_assist()` also requires `ui8_pedal_cadence_RPM > 0` to ramp
  current — it's a manually-triggered, pedaling-required current ramp for getting moving
  from a stop (steep climbs etc.), functionally unrelated to Walk assist (no pedaling
  needed) despite reusing its button. Real consequence: enabling Startup assist silently
  takes the walk-assist button away from plain Walk assist whenever the lights are on -
  i.e. exactly when riding at night, when you're also more likely to want to walk the
  bike hands-free without pedaling. `web_configurator`'s tooltip for this field now spells
  the trade-off out explicitly (see `startupAssistEnabled` in `ui-model.ts`), but the
  underlying UX is still the firmware's, not just a wording problem — a dedicated
  button/gesture (or at minimum a config option to pick lights-independent behavior)
  would remove the trade-off entirely instead of just documenting it. Not fixed now.
- **Firmware EEPROM migration** for bucket 2/3 constants — move from `config.h`
  `#define` to `eeprom.c`/`ebike_app.h` runtime fields, following the existing
  `m_configuration_variables` pattern. Phase 1's config editor schema becomes the
  source of truth for both the form UI and the EEPROM layout at this point.
- **Universal display support** — protocol autodetection + `#if`-to-runtime-dispatch
  restructuring for `ENABLE_VLCD5/VLCD6/XH18/850C/EKD01/ENABLE_860C_LVGL_UART` (the last
  one added 2026-08-19, after this list was originally written). **Baud rate has to be
  part of that dispatch, not just frame format** - found 2026-08-24 real-hardware
  bring-up: `uart.c`'s `uart2_init()` hardcodes UART2's baud rate with a single
  `#if ENABLE_860C_LVGL_UART` (19200 for the 860C/850C's own fixed UART1 rate, 9600 for
  every stock/DZ40-style display), completely separate from wherever this future
  autodetection dispatch would live. A real runtime autodetect scheme means either
  hardware-autobaud (not available on the STM8S105's UART2 peripheral) or a
  cycle-and-listen approach (try one baud/protocol pairing for a timeout window, fall
  back to the other, repeat) - workable, but doubles the coincidental-CRC-false-positive
  exposure already discussed elsewhere in this doc (now evaluated against two candidate
  protocols instead of one), adds real connect-time delay, and needs both protocols'
  full frame parse/build logic compiled into the same binary simultaneously (real flash
  cost on the already-constrained STM8S105) rather than only ever one of them per build,
  as today.
- **Voltage-class selection** — explicit one-time EEPROM-backed choice replacing
  compile-time `MOTOR_TYPE`.
- **Watchdog + overvoltage additions** — independent, can run in parallel with the rest
  of this phase.
- **WebSerial transport: plain UART / BT-serial EEPROM writes.** Blocked until EEPROM
  migration exists — nothing to tune at runtime before then. The low-risk, high-value
  no-laptop *tuning* path once it's unblocked.
- **WebUSB transport: ST-Link V2 (SWIM) EEPROM writes.** Reuses the same
  `stm8flash`-to-WASM port from Phase 1, now writing EEPROM bytes instead of full
  program flash.
- **Spike: in-browser (WASM) compilation of SDCC itself — DONE, pulled forward into
  Phase 1 (2026-08-12).** Originally thought harder than Phase 1's `stm8flash` port
  (SDCC normally spawns its assembler/linker as separate OS processes, which doesn't map
  to WASM's single-module execution model). Solved by building each stage (mcpp, sdcc
  `--c1mode`, sdasstm8, sdldstm8) as its own WASM module and orchestrating them from
  `src/sdcc-build.ts`, mirroring 8bitworkshop's approach. One caveat: the in-browser
  build is *not byte-identical* to a native build of the same `config.h` — SDCC's
  register allocator breaks `std::nth_element` ties differently under Emscripten's
  libc++ vs native libstdc++, and the 4.4.0→4.5.0 version bump changed codegen too —
  but the output is functionally equivalent, not byte-identical. Full write-up in
  `tools/CLAUDE.md`.

### Phase 5: Display firmware compiling (not started)

Extends Phase 3's flash-only display support to full build+flash parity with the
motor's tooling: compile 860C/850C/SW102 firmware in-browser from source, the same
way Phase 1 does for the motor's SDCC pipeline, instead of only flashing a pre-built
`.hex`. Not started — no design work done yet beyond the scoping below.

- **Why this wasn't done alongside Phase 3**: the display firmwares
  (`emmebrusa/Color_LCD_860C`) build with `arm-none-eabi-gcc`, not SDCC - a real
  toolchain-to-WASM port, comparable in kind to Phase 1's SDCC-to-WASM spike but a
  materially bigger lift (larger compiler codebase, slower Emscripten build, more
  moving parts). Since the near-term goal was just "flash the stock firmware from the
  browser instead of a separate tool," building wasn't on the critical path - see the
  discussion that led to Phase 3's scoping.
- **Real motivation only shows up once display source is worth modifying** - which is
  exactly what Phase 4's plan to rework displays to read config from EEPROM (instead of
  talking live to the motor) would create. Until then, compiling stock/unmodified
  display source in-browser has no real advantage over just downloading a release
  `.hex` and flashing it via Phase 3. Practically: this phase makes the most sense
  sequenced *after* (or alongside, if there's independent appetite) Phase 4's
  display-side EEPROM work, not before it.
- **Not scoped further than this** - no chip-ID/toolchain-flag research done yet, no
  vendoring decision made, no build-script design. Revisit when Phase 4's display work
  is actually underway, or if standalone appetite shows up first.

## Open / ongoing

Candidate firmware/tooling changes that have come up in discussion but aren't
scheduled, assigned to a phase above, or committed to. Absorbed the former standalone
`FUTURE_ENHANCEMENTS.md` on 2026-08-18 (now deleted) so these live in one place.

- **`set_motor_ramp()`'s fast-ramp unlock uses wheel speed/cadence as a proxy for "safe
  to stop protecting the drivetrain," but neither actually measures what's being
  protected (found 2026-08-14, discussion while explaining Motor acceleration/
  deceleration; from the former `FUTURE_ENHANCEMENTS.md`).**

  `set_motor_ramp()` (`firmwares/motor/tsdz2/src/ebike_app.c:677-712` as of the 2026-08-18 dzid26 merge,
  which shifted line numbers throughout this file without touching this function
  itself - stock upstream logic, landed in commit `6ac6c38` / `v20.1C.6-beta-0`, no
  fork-specific changes, no comment explaining the chosen thresholds) overrides the
  user-configured `MOTOR_ACCELERATION` ramp-up rate the moment wheel speed reaches
  20 km/h (~12.4 mph) **or** pedal cadence reaches 70 rpm - whichever happens first -
  snapping straight to the fastest possible duty-cycle ramp
  (`PWM_DUTY_CYCLE_RAMP_UP_INVERSE_STEP_MIN`) regardless of what percentage was
  configured.

  The thing `MOTOR_ACCELERATION` exists to protect is the TSDZ2's internal nylon
  reduction gear, which sits between the motor and the chainring/BB - downstream of the
  motor's own torque output, but entirely upstream of the rider's own drivetrain
  (derailleur/cassette). Wheel speed and cadence are both shaped by the rider's gear
  selection, which the firmware has no visibility into, so neither one reliably
  indicates how much torque the motor itself is currently putting into that internal
  gear - the actual quantity at risk. Concrete failure case: a hard launch in an
  easy/low gear can spin cadence past 70 rpm almost immediately while the bike is still
  barely moving, unlocking the fastest ramp within the first second - in exactly the
  low-speed-launch scenario a low `MOTOR_ACCELERATION` % is meant to protect against.

  **Not obsoleted by the dzid26 merge** (checked 2026-08-18, since dzid26's fork added
  related-sounding protections in the same neighborhood - see Phase 2's dzid26-merge
  entry above): its `apply_rev_matching()` and motor overrun mitigation (`firmwares/motor/tsdz2/src/motor.c`'s
  `overrun` flag) both operate one layer up, setting *what duty/current target* the
  motor should chase (matching motor speed to pedal cadence, or cutting duty when the
  motor free-spins past the pedals) - `set_motor_ramp()` is a separate, untouched
  mechanism controlling *how fast* the actual duty is allowed to approach whatever
  target was set, and it still gates its fast-ramp unlock on the same raw
  wheel-speed/cadence proxy described above. Confirmed via
  `git log --author=dzid26 -- firmwares/motor/tsdz2/src/ebike_app.c`: dzid26 never touched this function.

  **Possible fix:** base the fast-ramp unlock on the commanded battery current target
  (`ui8_adc_battery_current_target`) or its rate of change instead of wheel
  speed/cadence - that value is already computed every cycle in the same function, and
  it's the thing directly proportional to the motor's own torque output into the
  reduction gear, regardless of what gear the rider is in. Not implemented - would need
  real bench/road testing to tune (a current-based trigger risks its own failure modes,
  e.g. hunting/oscillating near a threshold under a pulsing pedal stroke, that the
  current speed/cadence heuristic doesn't have) and isn't obviously better in every
  case, just more correct for the specific thing it's supposed to be protecting.

- **Riding-mode state (Street/Offroad, Cruise, Walk assist) is spread across many
  parallel arrays and independent flags instead of one cohesive per-mode struct, and
  the same "master switch + separate opt-in extension" pattern is duplicated by hand
  for Cruise and Walk assist rather than expressed once (found 2026-08-15, while adding
  the web configurator's Riding modes DZ40 cards and fixing the missing master-switch
  gate on Street-mode cruise/walk-assist; from the former `FUTURE_ENHANCEMENTS.md`).
  Also not touched by the dzid26 merge - confirmed dzid26 never worked on Street/
  Offroad/Cruise/Walk-assist code (its 38 commits are all motor/cadence/wheel-speed/
  build-tooling, see Phase 2 above).**

  Concretely, in `firmwares/motor/tsdz2/src/ebike_app.c`: `ui8_wheel_speed_max_array[2]`,
  `ui8_walk_assist_enabled_array[2]`, `ui8_cruise_threshold_speed_x10_array[2]`,
  `ui32_adc_battery_power_max_x10_array[2]`, `ui8_throttle_mode_array[2]` -
  five separate file-scope arrays, all indexed the same way
  (`[m_configuration_variables.ui8_street_mode_enabled]`, i.e.
  `[OFFROAD_MODE, STREET_MODE]`), each holding one field of what is really a
  single "riding mode" concept. Adding a new per-mode setting means adding
  another same-shaped array by hand instead of one field to a shared struct,
  and nothing enforces that all five arrays actually agree on what
  `OFFROAD_MODE`/`STREET_MODE` mean.

  Separately, but in the same area: Cruise (`CRUISE_MODE_ENABLED` +
  `STREET_MODE_CRUISE_ENABLED`) and Walk assist (`ENABLE_WALK_ASSIST` +
  `STREET_MODE_WALK_ENABLED`) each reimplement the identical "compile-time
  master `#if` switch, plus a separate runtime flag that only extends the
  feature into Street mode and does nothing without the master on" shape,
  independently, with no shared abstraction tying the pair together. Nothing
  in the firmware enforces the pairing either - it's why the web configurator
  UI could silently let `STREET_MODE_CRUISE_ENABLED`/`STREET_MODE_WALK_ENABLED`
  be set to a config-h-generator-emitted `1` while the corresponding master
  was `0`, a real no-op configuration that looked valid in every field on its
  own (now fixed UI-side with an explicit dependsOn cross-check, but the
  firmware itself still has no such check or shared representation).

  Also related, found while checking whether DZ40's lack of a lights button
  affects anything besides the Street/Offroad toggle: the display's SET
  PARAMETER menu (`uart_receive_package()`, entered via a lights-button
  double-press) is one large nested `switch` on menu index, where each
  assist-level button (ECO/TOUR/SPORT/TURBO) is reused as a menu-position
  selector routing to a grab-bag of otherwise-unrelated settings depending
  on which top-level page of the menu you're in - Street/Offroad toggle,
  Assist mode on power-on, startup boost, torque sensor advanced, lights
  configuration, auto display data, and more, all sharing the same
  4-button/menu-index dispatch with no per-setting structure.

  **Possible fix:** not scoped or attempted - this is a real architectural
  observation, not a bug with a specific patch in mind. A cleaner design
  would likely group per-mode fields into one
  `riding_mode_config_t { power_limit; speed_limit; cruise_threshold; ... }`
  struct array indexed by `OFFROAD_MODE`/`STREET_MODE` instead of five
  parallel arrays, and give Cruise/Walk assist (and any future feature with
  the same shape) one shared "master + street-mode-extension" pattern instead
  of two hand-duplicated ones. Worth doing eventually, but a genuinely large
  refactor touching most of `ebike_app.c`'s riding-mode logic - not something
  to take on incidentally alongside a UI change, and every rider-facing
  release since this fork's inception has been validated by flashing and
  riding, not by a test suite that would catch a refactor regression here.

- **`MOTOR_ACCELERATION`'s real effective range is 0-100, not the raw uint8_t's full
  0-255 (found 2026-08-14, web configurator investigation).** `ebike_app_init()`
  (`firmwares/motor/tsdz2/src/ebike_app.c`) feeds it straight into `map_ui8(MOTOR_ACCELERATION, 0, 100, ...)`
  - same shape as `MOTOR_DECELERATION`/`SMOOTH_START_SET_PERCENT` right below it -
  and `map_ui8()` (`firmwares/motor/tsdz2/src/common.c`) clamps any input `>= in_max` to `out_max`, so 100
  through 255 all produce the exact same fastest-ramp result. Nothing in `config.h`,
  the header comment, or (until now) the web configurator said this - the field reads
  as a plain 0-255 value with no documented ceiling, unlike its sibling
  `MOTOR_DECELERATION` which the Java tool's own UI already exposed as a 0-100 slider.
  Not a functional bug (values above 100 are harmless, just pointless), but worth a
  firmware-side pass someday: either clamp/validate `MOTOR_ACCELERATION` at compile
  time the same way other cross-value interlocks already do (see main.h:167/454/473 in
  the current-state findings above), or just document the 0-100 ceiling directly next
  to the `#define`. Web configurator side already fixed (`sections/motor.ts`'s
  `motorAcceleration` now has the same `sliderRange: { min: 0, max: 100 }` its sibling
  does, and its tooltip states the clamp) - this entry is about the firmware/config.h
  side only.
- Coordinate with emmebrusa's stated direction (issue #150) once there's something
  concrete to show. Decide then whether to make the repo public / add an `upstream`
  remote / prepare a clean single-commit PR — deliberately not decided now.
- **TODO (new repo's README, not this one):** this repo's root `README.md` delegates
  prerequisites/setup entirely to `tools/web_configurator/README.md` (Node/npm to build,
  a Chromium-based browser to flash) — reasonable now since the root README's job here is
  fork-specific notes, not general onboarding. That won't hold up once universal
  firmware ships in the planned new no-upstream repo (see the "Making this repo public"
  non-goal above): at that point most users just flash a release and rely on
  auto-detection, touching EEPROM overrides only for exceptions, and the README becomes
  the actual entry point for strangers with arbitrary TSDZ2 bikes/displays — not one
  person's two named bikes. The new repo's README should put prerequisites + quick start
  front-and-center at the top level instead of two clicks deep in a subtool's doc.
  **Partial first step already taken in this repo (2026-08-18)**: the per-bike "Current
  status"/tuning/ride-log journal and the (largely nonfunctional given this repo's SDCC
  toolchain emits Intel HEX, not ELF - see the Makefile note that was already there)
  STMStudio/OpenOCD/gdb hardware-debugging section were both removed from the root
  README - the journal moved to `FIELD_TESTING.md`, the debugging section was dropped
  outright. Doesn't fully resolve this TODO (README still isn't a stranger-facing
  onboarding doc, and still assumes the reader already knows this is a personal fork),
  but it's a real move in that direction, not just a note for later.
- **Consider tagging this repo right before starting the universal-firmware
  refactor** (e.g. `pre-universal-firmware`) — cheap, reversible, and gives a clean
  reference point once `config.h`/the per-bike `.ini`-derived flow goes away. Not
  committed to; just worth doing given how much this switch changes.
- **`tools/web_configurator`'s config UI (`schema.ts`/`ui-model.ts`/
  `config-h-generator.ts`) is decoupled from the build/flash backend
  (`sdcc-build.ts`/`flasher.ts`), and `config.h`'s schema is shared with TSDZ8 (see
  the `stancecoke`/OSF finding above)** — so in theory someone could fork this UI and
  swap in an ARM-GCC-to-WASM build + a J-Link-based flash transport for TSDZ8, reusing
  the config editor as-is. The compile side is plausible (this repo already proved
  compiler-to-WASM works, just with SDCC not ARM GCC); the flash side is the real
  unknown — `stm8flash`'s SWIM protocol is open source, which is *why* it was portable
  to WebUSB at all, while Segger's J-Link protocol is proprietary, so a WebUSB/WebHID
  J-Link transport would need real reverse-engineering, not just a backend swap. Not
  something we're pursuing (see the TSDZ8 non-goal above) — noted here only because it
  came up and is a genuinely open door for someone else.
- **Street mode: under consideration, not yet implemented (2026-08-15).** User's
  observation riding a US-market bike maxed out in offroad mode: street mode exists to
  satisfy EU EN15194 compliance (250W/25km/h assist cap, no throttle-without-pedaling -
  the DZ40's own manual cites EN15194 as its scope of use), which has no equivalent
  requirement under US e-bike law (most states classify by spec/class, not a
  rider-togglable mode). For a US-only rider it's inert: both bikes already ship with
  street-mode limiting disabled, and it's toggled via the same hidden lights-button menu
  DZ40 can't reach anyway (see the cruise-override entry in Phase 2 above).
  Two separate, independent follow-ups discussed:
  1. **Web configurator: hide all street-mode fields when DZ40 is selected** (`streetWalkEnabled`,
     `streetCruiseEnabled`, `streetModeSpeedLimit`, `streetModePowerLimit`, etc.) - cheap,
     same `dependsOn`-on-display-type pattern already shipped for the Display page's
     DZ40-unsupported fields (commit `3efb3d2`). No firmware change.
  2. **Compile street mode fully out of the firmware** via a new `ENABLE_STREET_MODE`
     config.h macro. Scoped by grep (2026-08-15): 34 references in `ebike_app.c` alone,
     threaded through five paired offroad/street parameter arrays (power limit, speed
     limit, cruise threshold, throttle mode, walk-assist-enabled) plus one case in the
     hidden-menu toggle switch, plus a persisted EEPROM slot (`eeprom.h:30`, fixed byte
     offset 13). Not scattered cruft - a single boolean threaded consistently - but not a
     one-line `#ifdef` either. Recommended shape if pursued: collapse the array indexing
     to a compile-time-constant offroad value and strip the menu-toggle case under the
     new macro, but leave the EEPROM struct field itself alone (removing it risks
     layout/migration issues for existing saved configs, for no real benefit). Honest
     tradeoff: on a ~23-30KB STM8 binary the flash/RAM reclaimed is negligible - the
     actual win is fewer branches to reason about and one less case in the hidden-menu
     state machine, an area with a real history of state-machine bugs only caught by
     flashing and riding (see the cruise-override entry in Phase 2 above). Worth doing
     for clarity, not for size. Not started - revisit once there's appetite to touch
     this area again.
- **Walk-assist speed doesn't honor the flagged "5th" assist level's
  `ASSIST_LEVEL_5_PERCENT` scaling, even though the same scaling mechanism works
  correctly for every other riding-mode trigger (found 2026-08-15, curiosity
  investigation while reviewing DZ40's 5-gear PAS mapping).**

  DZ40's 5 physical PAS gears map to 4 real firmware levels (ECO/TOUR/SPORT/TURBO)
  plus one flagged "5th" gear (`ASSIST_LEVEL_5_MODE` = `BEFORE_ECO` or `AFTER_TURBO`)
  that reuses ECO's (or TURBO's) row in `ui8_riding_mode_parameter_array`, scaled by
  `ASSIST_LEVEL_5_PERCENT` - confirmed as an intentional, display-position-dependent
  design by mbrusa (OSF firmware author) directly, in [endless-sphere post
  #2,979](https://endless-sphere.com/sphere/threads/tsdz2-osf-for-all-displays-vlcd5-vlcd6-xh18-lcd3-860c-850c-sw102.110682/page-120):
  `BEFORE_ECO` puts the 5th gear below ECO (scaled <100%, e.g. DZ41), `AFTER_TURBO`
  puts it above TURBO (scaled >100%, e.g. EKD01) - the config choice exists because
  different displays position the extra gear differently.

  This scaling is wired generically for every riding mode via `ui8_assist_level_5_flag`,
  including the walk-assist-button capture code (`ebike_app.c:2970-2973`), right after
  the walk-assist speed lookup. But `ui8_assist_level_5_flag` is reset to 0 every poll
  (`ebike_app.c:2350`) and only re-set to 1 if the display's *current* reported level
  matches `ASSIST_PEDAL_LEVEL5` exactly - and DZ40/VLCD5 displays report a *decremented*
  level while the walk-assist button is held (the reason `ui8_assist_level_before_walk_button`
  exists at all, snapshotted at `ebike_app.c:2341-2343` specifically to route around this
  same problem for the base assist level). `ui8_assist_level_5_flag` never got the same
  before-button snapshot treatment, so the instant the walk-assist button is held, the
  flag silently reads false for the whole hold, regardless of which physical gear
  (1=flagged or 2=real ECO) the rider started from. Net effect: gear 1 and gear 2
  currently produce byte-identical walk-assist behavior, even though the scaling
  mechanism that would differentiate them already exists and works correctly everywhere
  else it's used.

  **Possible fix:** mirror the existing pattern exactly - add a
  `ui8_assist_level_5_flag_before_walk_button`, snapshot it alongside
  `ui8_assist_level_before_walk_button` at `ebike_app.c:2341-2343`, and reference that
  snapshot instead of the live flag in the scaling check at `ebike_app.c:2970-2973`.
  Small, contained, same code block that already handles this exact class of problem.

  **Not scheduled - user explicitly declined this fix (2026-08-15).** Reasoning:
  (1) not every display has 5 PAS modes, so this isn't broadly useful; (2) not short on
  walk-assist levels as-is; (3) a real design objection - `ASSIST_LEVEL_5_PERCENT` is a
  power-curve knob (scaling torque/cadence assist to fake a 5th PAS gear), and having it
  also silently govern walk-assist speed would couple two physically unrelated things
  behind one dial (tuning "how weak gear 1 feels while pedaling" would also retune "how
  fast walk assist pushes the bike"). This was a curiosity question, not a bug report to
  act on - if it comes up again, lead with the design-coupling objection before
  proposing the fix.
