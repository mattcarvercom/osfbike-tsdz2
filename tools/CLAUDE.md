# tools/ - guidance for Claude Code

This folder holds the configurator tooling around the TSDZ2 firmware in `../src`. For
the *other* kind of firmware testing - a native pytest/cffi harness that compiles and
calls real `src/*.c` logic directly, no browser involved - see `../CLAUDE.md`.

| Path | What |
|---|---|
| `web_configurator/` | **Active tool.** Browser-based build+flash for the firmware - see below. |

2026-08-12: removed the legacy Java Swing configurator (`Java_Configurator_Source/`,
`../JavaConfigurator.jar`), its native flashing tools (`tool-stm8flash/`, `cygwin_32/`,
`cygwin_64/`, `ST_Vision_Programming.stp`), the debug-only `stm8-gdb.zip`, the
unreferenced `BLDC_SPWM_Lookup_tables.ods`, and the `60-st_link_v2.rules` udev rule (only
needed for native `stm8flash`/OpenOCD use, which isn't part of this fork's day-to-day
workflow) now that `web_configurator/` has been validated build-and-flash on real hardware
(see "Build & flash page" below). The legacy `.ini` field order those old tools encoded is
still preserved in `web_configurator`'s importer (see `web_configurator/src/ini-import.ts`).

Everything below is about `web_configurator/`.

## What it is

A Vite + TypeScript (no framework) web app that replaced the Java configurator
*and* the shell scripts around it (`compile_and_flash_20.sh`,
`firmwares/motor/tsdz2/src/Makefile`'s `backup`/`flash` targets): edit
firmware settings through a keyed UI, build
`firmware.hex` from SDCC's real STM8 toolchain compiled to WebAssembly, and
flash/backup/restore over WebUSB with a real ST-Link - all client-side, no
server, no native SDCC/Java/stm8flash install required.

Full day-to-day usage/setup/rebuild instructions live in
`web_configurator/README.md` - read that first for anything about running or
rebuilding the tool. Full design history/rationale is in
`../UNIVERSAL_FIRMWARE_PLAN.md`. This file also records the resolved
investigation into why the in-browser build isn't byte-identical to native
(root cause found 2026-08-12; see below) - it exists to orient a fresh
Claude Code session (e.g. on a different machine) so that work isn't
redone.

```sh
cd web_configurator
git submodule update --init --recursive   # vendor/{sdcc,mcpp,stm8flash}
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build
npm test          # node:test suite - schema/import/UI-model coverage
npm run check     # typecheck + eslint + prettier --check
npm run preflight # check + test + test:e2e, the full local gate before pushing
```

CI (`.github/workflows/web-configurator*.yaml`) runs `check`/`test`/`build`/
`test:e2e` on every push/PR touching this directory, plus a separate
supply-chain audit (Socket Firewall install + behavioral scan + offline CVE
scan) whenever `package.json`/`package-lock.json` changes - see
`web_configurator/README.md`'s "CI" section for what each step does.

## Source layout (post 2026-08-14 module split)

`src/main.ts` and `src/ui-model.ts` used to be 2794- and 1814-line monoliths -
the biggest source of PR conflict surface in the tool - and got split along
natural seams (commit `6b0801e`). If a search for something turns up empty in
`main.ts`, it's not there anymore; it moved to one of these:

- `src/main.ts` is now a 41-line bootstrap only.
- `src/dom.ts`/`app-state.ts`/`speed-units.ts`/`assist-level5.ts` hold the
  shared primitives/state main.ts used to own directly.
- `src/render/*.ts` + matching `*.css`: one file pair per page/component
  (`topbar.ts`, `sidebar.ts`, `build-flash-page.ts`, `control.ts`,
  `control-group.ts`, `restore-banner.ts`, `footer.ts`, `assist-chart.ts`,
  `app-shell.ts` orchestrates them all), each importing its own CSS directly
  rather than one shared `style.css`.
- `src/ui-model.ts` now only assembles `sections/*.ts` (one file per sidebar
  page, each owning its own field metadata + named radio/intSelect controls)
  via `buildControls()`.

Verified at the time with no behavior change (every CSS selector accounted
for exactly once old vs new, `buildControls()`'s full output diffed
identical) - so anything written before 2026-08-14 that references
`main.ts`/`ui-model.ts`/`style.css` by line number or as if the logic still
lives there is describing the pre-split layout; the behavior it describes
still applies, just relocated per the list above.

## In-browser SDCC build (SDCC 4.5.0) vs native: not byte-identical — root cause known

`web_configurator` can build `firmware.hex` entirely in-browser (SDCC's
preprocessor/compiler/assembler/linker, each stage its own WASM module,
orchestrated by `src/sdcc-build.ts` - see README's "In-browser firmware
build" section for the full pipeline explanation). The in-browser build and
a native build of the *same* `config.h` produce **valid but not
byte-identical** firmware (both use the same SDCC 4.5.0 pin `9f69e0d62` and
the same firmware source). The reason is fully understood and is **not a
correctness bug** — see "Root cause" below. The investigation that got here
is recorded under "Investigation history" further down.

### Root cause (found 2026-08-12)

The gap is caused by **`std::nth_element` tie-breaking in SDCC's STM8
register allocator**, which differs between the two C++ standard libraries
the two builds link against: **libstdc++ (native)** vs **libc++
(Emscripten/WASM)**.

The mechanism:

1. SDCC's STM8 register allocator is `src/stm8/ralloc2.cc` + the shared
   `src/SDCCralloc.hpp`. To bound the search, `SDCCralloc.hpp:788`
   `drop_worst_assignments()` keeps only the best
   `options.max_allocs_per_node` assignments per tree-decomposition node
   (default 3000, so it starts dropping once a node holds >500 assignments
   for the 6-register stm8 port).
2. It ranks assignments with `std::nth_element` (lines 852 & 868) over an
   array of `assignment_rep { iterator i; float s; }` whose
   `operator<` (line 749) compares **only the float `s`**:
   ```cpp
   bool operator<(const assignment_rep& a) const { return(s < a.s); }
   ```
   The float `s` is a sum of `instruction_cost()` (dry-run cycle/byte
   counts), `compatibility_cost()` (adds `1000.0f` per conflict) and
   `rough_cost_estimate()` (adds `0.05f`/`0.1f`/`4.0f`). Equal costs tie.
3. `std::nth_element` with a comparator that returns equal for ties leaves
   *which* tied elements land in the kept region **implementation-defined**.
   libstdc++ (introselect) and libc++ (a different introselect) partition
   tied elements differently.
4. Different kept assignments → different register allocation → different
   (but equally valid) generated assembly.

**Proof** (all on this machine `architect`, SDCC 4.5.0 pin `9f69e0d62`,
diffing `common.c` `--c1mode` output): a build linked against `libc++`
(`clang++ -stdlib=libc++`, `ldd` confirms `libc++.so.1`) reproduces the
documented WASM signature *exactly* — `ld a, yl` / `clr (0x08, sp)` /
`adc a, (0x08, sp)` — while every libstdc++ build produces the native
`exg a, yl` / `clr a` / `(0x04, sp)` form. The diff between libstdc++ and
libc++ is 8 lines, localized to `map_ui8`'s 32-bit multiply/add region, the
same place the original native-vs-WASM diff diverged.

**Is it safe to flash the WASM-built firmware?** Yes, with the same caveat
as every prior release. SDCC's allocator only ever emits *valid*
assignments; the tie-break merely chooses *which* of several equally-valid
allocations survives the pruning, so the WASM output is an ordinary,
correct SDCC output — it is not made more or less likely to be buggy by the
tie-break. The real (and only) risk is that no WASM-built hex has been
ridden yet, which is the exact validation gap every past release carried,
and it is *smaller* than the version-bump risk already accepted (native
4.4.0→4.5.0 differs in 21k/23k bytes vs. this tie-break's ~14k/23k). The
user's plan — flash a 4.5.0 in-browser hex and ride — is the correct
validation and no riskier than flashing 4.5.0-native.

**Reproducibility caveat (the one real, non-safety consequence):** because
the tie-break depends on `std::nth_element`, the same `config.h` can yield
*different* hexes across different libc++ versions (Emscripten releases) —
and the same already applies to native across libstdc++ versions. If "this
`config.h` → this exact hex" is ever required (e.g. for provenance or
verifiable builds), the fix is a deterministic value-based tiebreaker, e.g.
`return s < a.s || (s == a.s && *i < *a.i);` (`assignment` already has a
lexicographic `operator<`), applied to the vendored SDCC **and** used on
both the native and WASM sides. Not needed for correctness; not filed
upstream (per prior instruction).

### Investigation history (2026-08-12)

Chronological record of how the root cause was found. Everything below is
superseded by the "Root cause" section above; kept for context and reruns.

#### What was tested and found

Ran this doc's own test plan via a real headless-Chrome harness driving the
app's actual `importIni -> generateConfigH -> buildFirmwareHex` code path:

1. **Native `make` on this machine reproduced a real flashed release
   byte-identical**: rebuilt a real release `.hex`
   from its exact git-committed `../src/config.h`, `objcopy -I ihex -O binary`
   + `cmp` came back identical. **This rules out the old "built on a
   different machine" theory outright** - this machine's native SDCC/objcopy
   *is* what built the releases, and it's trustworthy.

2. **In-browser WASM build of the same exact `config.h` did not match**:
   byte-identical only through the interrupt vector table, then diverges for
   95.7% of the remaining bytes, and comes out ~2% larger (23850 vs 23372
   bytes). A real content difference, not a format/framing artifact.

#### Two real orchestration bugs found and fixed (not the root cause)

`web_configurator/wasm-sdcc/build.sh` configures SDCC with
`--disable-device-lib` (see its `emconfigure ./configure` invocation).
Building the real prelinked `device-lib` archive under Emscripten wasn't
straightforward, so `sdcc-build.ts` instead compiles SDCC's real
`device/lib` *sources* itself (copied verbatim from `vendor/sdcc`, not a
hand-reimplementation) and links the resulting `.rel` files directly. Two
bugs in how that was done, both now fixed in `sdcc-build.ts`:

1. **`_startup.c` was missing entirely.** `src/stm8/main.c` unconditionally
   `call`s `___sdcc_external_startup` in every STM8 program's
   compiler-generated boot preamble - not optional, despite only ever
   producing a link *warning*, never an error. Its absence meant that call
   resolved to an undefined/placeholder address. Fixed by adding
   `lib-c/_startup.c` to the runtime bundle.

2. **The bigger one: every runtime helper file was linked unconditionally,
   whether the firmware actually referenced it or not.** A native build
   gets "only link what's needed" for free - `sdcc`'s default STM8 link
   implicitly appends a real `stm8.lib` *archive*, and archives only pull in
   members whose symbols are undefined at link time. Passing loose `.rel`
   files directly on the linker command line (what this file did) doesn't
   get that: loose objects link unconditionally. Confirmed via a native
   link map (`sdcc ... -Wl -m -o out.elf`) that this exact firmware only
   ever needs 9 of the ~20 available runtime routines
   (`__mulsint2slong`/`__muluint2ulong`, `_mulschar`/`_muluschar`/`_mulsuchar`,
   `_mulint`, `_divslong`, `_divulong`, `_startup`, `_mullong`, `_divsint`,
   `_fast_long_neg`) - the other ~11 (`setjmp`, `strcmp`, `strcpy`, `heap`,
   `memcpy`, `atomic_flag_test_and_set`, `_modsint`, `_modslong`,
   `__mululonguchar2ulonglong`, `_modulong`, `_muluchar`) are genuinely dead
   code for this firmware and were bloating every in-browser build by
   hundreds of bytes, silently shifting every address after them. **Fixed**:
   `sdcc-build.ts` now links with zero runtime helpers first, parses
   `ASlink-Warning-Undefined Global` from the result, compiles+links only
   the files that actually resolve missing symbols (`HELPER_SYMBOLS` map),
   and repeats until stable - genuinely mirroring archive as-needed linking
   instead of guessing a fixed file list. (First version of this fix had its
   own bug too: `_mulschar.c` defines 3 related symbols in one file, and the
   map only had one of them - caught by rerunning the native-link-map
   comparison again after the first attempt.)

**After both fixes, the linked object set now matches native's exactly -
verified against the link map above.** But the byte-for-byte gap barely
moved (still ~480 bytes / ~2% larger, same divergence point right after the
interrupt vector table). So neither bug was the root cause of the gap
itself, even though both were real and worth fixing on their own.

#### Hypothesis-by-hypothesis isolation

The initial theory ("UB in SDCC's own source, depending on what compiler
built SDCC") was reopened as a falsifiable list, each tested by building
native SDCC 4.5.0 (pin `9f69e0d62`) with a different host toolchain and
diffing the `common.c` `--c1mode` output against the documented WASM
signature. Method per build: `mcpp` (built natively from `vendor/mcpp`, the
exact preprocessor the WASM pipeline uses) → `common.i`, then
`sdcc --c1mode -mstm8 -DSTM8S105 -Ddouble=float --std-c99 --nolospre
--opt-code-speed --peep-asm --peep-file peep.txt -o common.asm < common.i`,
diffed across builds. The 64-bit GCC build reproduced the documented
*native* signature (`exg a, yl` / `clr a` / `(0x04, sp)` offsets) exactly,
so the harness is trustworthy.

| # | Hypothesis | Result |
|---|---|---|
| 1 | `sizeof(long)`/pointer ABI gap (wasm32 is ILP32, x86_64 is LP64) | **DISPROVEN** — SDCC built `-m32` (GCC, real 32-bit `long`/`void*`) produced byte-identical `common.asm` to the 64-bit build (only the `.module` name differs). Also implicitly covers `size_t`, `long long`/`double` alignment (i386 aligns `long long`/`double` to 4, wasm32 to 8 — both produce identical codegen). |
| 2 | GCC vs clang difference in how SDCC itself is compiled | **DISPROVEN** — SDCC built with clang-21 (64-bit, same ABI) produced byte-identical output to the GCC build. |
| 3 | `char` signedness (`-funsigned-char` vs signed) | **DISPROVEN** — SDCC built with `-funsigned-char` produced byte-identical output. |
| 4 | Floating-point precision (x86 80-bit extended / `long double`) | **DISPROVEN** — SDCC built with `-mfpmath=387 -ffloat-store` (forces 80-bit x87 + store-to-memory rounding) produced byte-identical output. Grep found no actual `long double` usage in the codegen path (only a comment + an error string). |
| 5 | Uninitialized-read UB (wasm linear memory is zero-initialized, native heap/stack are garbage) | **DISPROVEN** — valgrind memcheck (`--track-origins=yes`) on native SDCC compiling `common.c` reported **0 errors**: no uninitialized reads, no invalid accesses, no conditional jumps on uninitialized values. |
| 6 | `boost::container::flat_multimap` bug (SDCC's `operand_map_t`) — documented miscompile under new GCC/clang (boost #281 → SDCC #3739/#3697), with `std::multimap` fallback only for boost 1.83–1.85 | **NO EFFECT on this machine** — host boost is 1.90 (fix landed 1.86); forcing the `std::multimap` fallback via editing the `#if` in `SDCCralloc.hpp` produced byte-identical output. Still the best-documented *example* of the failure class: a compiler-optimization-dependent miscompile of a header SDCC's allocator depends on. |
| 7 | **Standard-library implementation: libstdc++ (native) vs libc++ (Emscripten)** | **CONFIRMED — this is the root cause.** |

#### SDCC 4.5.0 upgrade attempt: did NOT fix it, but the repo is pinned to it anyway

Found a lead: SDCC 4.4.0's own SourceForge wiki page has a maintainer
comment (Benedikt Freisen, 2024-02-04 - a discussion reply, **not** the
official release notes text) saying win64 builds had "strange code
generation stability issues" that couldn't be resolved in time for release.
SDCC 4.5.0 (Jan 2025) shipped win64 binaries again. Worth testing whether
whatever fixed that also fixed this repo's WASM-vs-native gap, since both
smell like the same class of bug (SDCC's own codegen depending on what
built SDCC).

**It didn't.** Tested three points along SDCC's history, all on this
machine, all via the same method (native build with a from-source native
SDCC install at that exact commit, in-browser build via a rebuilt
`wasm-sdcc/build.sh`, `objcopy -I ihex -O binary` + `cmp`, plus the isolated
`common.c` `preprocess()`+`compile()` vs. native `sdcc -S` diff):

- **4.4.0** (`d42f99b`, r14620, the original pin): gap confirmed, per above.
- **4.5.0** (`9f69e0d62`, official release, Jan 2025): gap still present.
  Full binary: 23,241 (native) vs 23,243 (in-browser) bytes, differs
  starting right after the interrupt vector table, ~14,700 of 23,241 bytes
  differ (most of that is one root divergence's address-shift cascading
  through everything after it, not 14,700 independent bugs).
- **Unreleased trunk HEAD** (`32d54288f`, r15451, Jun 2025, 177 commits past
  4.5.0 with nothing in their commit messages about register allocation,
  determinism, or sanitizers): gap still present, same shape.

All three showed the **exact same instruction-level divergence** in
`common.c`'s `map_ui16`/`map_ui8` — native `exg a, yl` / `ld (0x04, sp), a`
/ `clr a` / `adc a, (0x04, sp)` vs in-browser `ld a, yl` / `clr (0x08, sp)`
/ `adc a, (0x08, sp)` — byte-for-byte identical across all three SDCC points
spanning ~1.5 years of upstream development. Whatever fixed win64 in 4.5.0,
it wasn't this. (In hindsight: this stability across versions is exactly
what the libc++-vs-libstdc++ root cause predicts, since the `nth_element`
tie-break code is unchanged across those versions.)

**Also found while testing this**: native firmware output itself changes
substantially between SDCC versions - native-4.4.0 vs native-4.5.0 of the
same `config.h` differs in 21,367 of 23,241 bytes (expected: 4.5.0 changed
real optimizer/peephole behavior, this is normal compiler-version drift,
unrelated to the WASM-vs-native bug above). This means adopting a newer
SDCC version for real firmware is its own separate decision from "does the
WASM build match native" - the instructions genuinely differ from what's in
`releases/`, not just cosmetically.

**Decision (2026-08-12, the user's call, made with full knowledge of the
above)**: `vendor/sdcc` stays pinned to **4.5.0** (`9f69e0d62`), not
reverted to 4.4.0. Reasoning given: this repo's only real "validation"
methodology has always been build-with-native-`make`-and-ride, not formal
bench testing, so a from-source native 4.4.0 build reproducing old releases
byte-for-byte was never proof of anything beyond "matches what shipped" -
it doesn't make 4.4.0 more trustworthy than 4.5.0 in any deeper sense, and
4.5.0 carries genuine upstream bug fixes. The user's plan is to flash a
4.5.0-in-browser-built hex directly and test by riding, the same way every
previous release was validated.

#### Sanity-check against the actual file headed for the bike

Ran the exact same native-4.5.0-vs-in-browser-4.5.0 comparison through the
real `importIni()` -> `generateConfigH()` -> `buildFirmwareHex()` pipeline
(not just `buildFirmwareHex()` directly) on a real `.ini` from a real
bike - same signature gap (23,241 vs 23,243 bytes, diverges right after the vector
table, 14,722 bytes differ), confirming the corrected power-assist-level
fix (all 4 levels rescaled to fit `uint8_t`, ECO 100/TOUR 150/SPORT 200/
TURBO 255) survived the pipeline and that this specific file isn't hitting
some new, worse divergence beyond the already-characterized one.

### Test plan (for rerunning if this gets picked up again)

1. **Native vs in-browser, same `config.h`, full linked binary**: build a
   known release's exact `../src/config.h` via `cd ../src && make clean &&
   make` (native) and via a throwaway harness page calling
   `sdcc-build.ts`'s `buildFirmwareHex(configH, log)` directly (in-browser).
   `objcopy -I ihex -O binary` both, `cmp`. Note the *native* side needs a
   native SDCC install matching whatever `vendor/sdcc` is pinned to -
   `/usr/local/bin/sdcc` on this machine is still 4.4.0, not 4.5.0, so it's
   no longer a valid comparison baseline as-is (build a fresh one from
   `vendor/sdcc` source into a throwaway prefix instead - see the sdas/
   linksrc gotcha below).

2. **Isolate to one file's codegen** (the more informative check): call
   `preprocess()` then `compile()` (in `sdcc-build.ts`, both currently
   unexported - `export` them temporarily for this, along with
   `firmwareCH`/`firmwarePeep`/`runtimeFiles`) on a single real firmware
   `.c` file with the same `config.h`, and diff the resulting `.asm`
   against `sdcc -S` of the same file natively (same `CFLAGS`/
   `--peep-file`). This is what actually found the root cause above; the
   full-binary diff alone doesn't distinguish a codegen issue from a
   linking/layout one.

3. **Building a native SDCC from `vendor/sdcc` source, if a matching one
   doesn't already exist**: `./configure --prefix=<throwaway dir>
   --disable-<every non-stm8 port, see wasm-sdcc/build.sh's DISABLE_PORTS
   for the list> --disable-ucsim`, then **before** `make`/`make install`:
   `sdas/linksrc` fails to compile under this machine's GCC with a
   "conflicting types for 'elf'" error (K&R-style prototype mismatch,
   GCC 14+ rejects what older GCC allowed) *and* a "'for' loop initial
   declarations" error if built with `-std=gnu89` (which is what
   `wasm-sdcc/build.sh` uses for the WASM build - clang tolerates it there
   as a warning, GCC does not). Fix: build `sdas/linksrc` separately first
   with `-std=gnu99` (not `gnu89`): `cd sdas/linksrc && make sdcc-ldstm8
   CFLAGS="-std=gnu99 -pipe -DINDEXLIB -DUNIX -I. -I."`, *then* run the
   normal top-level `make && make install` - the top-level `make all`
   silently tolerates linksrc failing (it's not a hard dependency of
   `all`), but `make install` is not so forgiving and fails outright
   without this.

`vendor/sdcc` and `emsdk` are available on this machine if picking this back
up (installed 2026-08-12 under `tools/web_configurator/.emtoolchain/` and
via `git submodule update --init --recursive` - `emsdk` install docs at
https://emscripten.org/docs/getting_started/downloads.html if it needs
reinstalling).

## Build & flash page: two real bugs found and fixed (2026-08-12)

(This page was later split (2026-08-19) into separate Build and Backup &
flash pages - see render/build-page.ts and render/backup-flash-page.ts. Both
bugs below applied to the same shared logic, now living across those two
files.)

Found while actually flashing a real motor controller with the SDCC 4.5.0
build above. Both fixed in commit `ec259a5`.

**1. Progress logs were invisible.** The build/flash/backup/restore buttons
all set an "in progress" flag and immediately call `renderApp()` - a full
`app.innerHTML = ""` + rebuild, done on every state change throughout this
app. That replaced the log `<pre>`/status `<p>` DOM nodes with fresh empty
ones while the async operation's `onLog` callback was still a closure over
the *old*, now-detached nodes - so every progress line, including the final
"Done."/error line, was written somewhere the user could never see. Fixed by
moving the log lines into `AppState` (`buildLog`/`flashLog`/`backupLog`/
`restoreLog`) so each rebuild reads back its own latest output, matching the
pattern already used for `statusMessage`.

**2. Flashing could crash with "memory access out of bounds".** Root cause:
`vendor/stm8flash/stlinkv2.c`'s `stlink2_swim_write_range()` (the
`ONLY_WRITE_DIFFS` "skip identical blocks" optimization, enabled) does
`alloca(rounded_size)` - a **stack** allocation sized to the device's flash
(32-128KB depending on part, see `stm8.c`) - on every flash write.
Emscripten's default WASM stack is only 64KB total, shared with the rest of
the call chain, so it overflows. Native builds never hit this (desktop
stacks are MBs). Fixed with `-sSTACK_SIZE=1048576` in `wasm/build.sh`
(no vendor C changes) and rebuilding `src/wasm/stm8flash.wasm`.

**A crash mid-flash-write can leave the MCU with a partial mix of old/new
flash blocks** (STM8 flash writes are block-granular; blocks already written
before the crash keep the new content, later ones keep the old). Don't trust
a controller that hit this crash without a clean, error-free reflash after.

**Investigation note, corrected:** while chasing bug 1's "IO error: expected
16 bytes but 0 bytes transferred" / "Done. undefined bytes written." symptom
(a dropped WebUSB session, separate from either bug above - reseating the
ST-Link's USB cable and SWIM/reset wiring resolved it), it looked like
`stlinkv2.c`'s `msg_send()` might retry a failed transfer forever (unbounded
`while (length > 0)` loop, 1s `usleep` between attempts, no cap) - this was
**wrong** and was retracted after actually reading `error.h`:
`ERROR2(...)` expands to `fprintf(stderr, ...); exit(-1);`, so
`msg_transfer()` terminates immediately on any byte-count mismatch and never
returns a short count for `msg_send()`'s retry branch to act on - that
branch is dead code in practice. The real explanation for "Done. undefined
bytes written." is that this WASM build's `-sEXIT_RUNTIME=0` + Asyncify
config doesn't turn a mid-call C `exit()` into a rejected `ccall` promise -
it resolves with `undefined` instead. `flasher.ts` now treats any
non-finite `ccall` result as failure (`!Number.isFinite(bytesWritten)`),
which covers this regardless of the exact Emscripten mechanism. No vendor
patch needed for this one.

## Display firmware flashing (860C/850C, SW102) - added 2026-08-18, not yet hardware-tested

A second, separate top-level page (`src/render/display-flash-page.ts`, its
own sidebar tab - deliberately not folded into "Build & flash", which stays
motor-only) flashes stock/pre-built display firmware from
[emmebrusa/Color_LCD_860C](https://github.com/emmebrusa/Color_LCD_860C) over
the same ST-Link, using SWD instead of the motor's SWIM. Flashing only, not
building - these display firmwares run unmodified for now; in-browser
building is deferred to the universal-firmware cutover, alongside reworking
the displays to read config from EEPROM instead of talking live to the motor
(see `../UNIVERSAL_FIRMWARE_PLAN.md`).

Two chip families, two very different implementation stories:

- **860C/850C (STM32F103)**: `vendor/stlink` ([stlink-org/stlink](https://github.com/stlink-org/stlink))
  is vendored and does the real work - its FPEC flash algorithm and STM32
  chip-ID table are used almost directly (`wasm-display-flash/wasm_api.c`'s
  `stm32_flash_write_hex()`), mirroring exactly what its own `st-flash` CLI
  does (see `vendor/stlink/src/st-flash/flash.c`'s `FLASH_CMD_WRITE` branch
  for the reference sequence this follows).
- **SW102 (nRF51822)**: `stlink-org/stlink` has **zero** Nordic chip support
  (its `config/chips/` directory is STM32-only - confirmed by inspection,
  also why `Color_LCD_860C`'s own SW102 build uses OpenOCD, not st-flash).
  `wasm-display-flash/nrf51_nvmc.c` is a from-scratch implementation of
  Nordic's documented NVMC register sequence (erase/write/poll-ready),
  built entirely on `stlink_read_debug32()`/`stlink_write_debug32()` - the
  same chip-agnostic "read/write one 32-bit word over the debug port"
  primitives the STM32 path uses internally. No loaded flash algorithm
  needed for either chip: both have directly memory-mapped flash
  controllers, so writes are ordinary AHB-AP memory writes once the right
  control register is poked.

### The hard part: faking USB enumeration, not the protocol

`vendor/stm8flash`'s vendored code (used by `wasm/`) never needed real
libusb device enumeration - its own `stlink2_open()` skips straight to
issuing SWIM commands. `stlink-org/stlink`'s `stlink_open_usb()` does real
enumeration (`libusb_get_device_list()`, per-device open + serial-string
read, kernel-driver checks, config/claim) before it ever touches the wire
protocol - none of which makes sense when WebUSB already handed JS one
specific, already-permissioned, already-open, already-claimed device.

Two ways to bridge that gap were considered and only one was used:

- ~~Write a parallel, trimmed copy of `stlink_open_usb()` in `wasm_api.c`~~
  - **ruled out**: it needs `_stlink_usb_backend`, which is `static` at file
    scope in `usb.c`. A duplicate function outside that file can't reach it
    without patching the vendored source (breaks the zero-local-patches
    convention this repo's other submodules already follow).
- **Fake the enumeration at the libusb-shim layer instead** (what
  `wasm-display-flash/shim-include/libusb.h` + `usb_bridge.c` actually do):
  present exactly one fake USB device with a real VID/PID (set via
  `usb_bridge_set_expected_pid()`, mapped from `usb-transport.ts`'s
  existing `usb_type` before calling in), and let the real, unmodified
  `stlink_open_usb()` "discover" and "open" it. ~13 libusb functions become
  stateless stubs reporting "already done" (`libusb_claim_interface`,
  `libusb_set_configuration`, kernel-driver checks, etc. - WebUSB already
  did all of that JS-side); only `libusb_bulk_transfer` does real work
  (the same `usb_bridge_bulk_out`/`usb_bridge_bulk_in` EM_ASYNC_JS bridge
  `wasm/usb_bridge.c` already uses for `stm8flash`, copied verbatim). The
  one fiddly part: `stlink_serial()` (`usb.c`) insists on a well-formed
  50-byte USB string descriptor shape before accepting a device as valid -
  the fake `libusb_get_string_descriptor()` fabricates one with fixed
  placeholder content, since there's only ever one device and no real
  multi-device serial matching happens.

Net effect: every byte of actual ST-Link/SWD protocol traffic (version
query, mode detection, SWD entry, target connect, flash read/write) is
`stlink-org`'s real, unmodified code - nothing about the wire protocol
itself is reimplemented, only the "which USB device is this" preamble.

### Bypassing CMake: real gotchas, all in `wasm-display-flash/build.sh`

`vendor/stlink` is a CMake project; `wasm-display-flash/build.sh` compiles a
hand-picked flat file list with a single `emcc` invocation instead (`src/
stlink-lib/` is cleanly separable from the CLI tools in `src/st-flash/` etc,
so this is viable - unlike `wasm-sdcc`, which genuinely needs
`emconfigure`/`emmake`). Bypassing CMake means several `check_include_file`-
style feature checks it would normally run have to be supplied by hand:

- `-DSTLINK_HAVE_DIRENT_H`, `-DSTLINK_HAVE_SYS_MMAN_H`,
  `-DSTLINK_HAVE_SYS_TIME_H` - Emscripten's sysroot has real
  `<dirent.h>`/`<sys/mman.h>`/`<sys/time.h>`, so these select the "real
  POSIX header" branch over vendor/stlink's own win32 portability shims
  (`src/win32/mmap.h`, `src/win32/sys_time.h`) - without them, compilation
  fails outright (`fatal error: 'win32/mmap.h' file not found` etc., since
  those shims are declaration-only stubs with no corresponding `.c`).
- `inc/version.h.in` needs `configure_file()`-style substitution CMake
  would normally do - `wasm-display-flash/generated/version.h` is a
  hand-written stand-in (the actual version string is never read by
  anything this app's code path calls, only by `st-flash`'s own CLI banner,
  which isn't compiled in).
- `src/stlink-lib/common_legacy.c` (despite the name) isn't optional/dead -
  it defines core API functions (`stlink_close`, `stlink_run`,
  `stlink_reset`, `stlink_version`, `stlink_current_mode`,
  `stlink_target_connect`, `stlink_core_id`, `stlink_target_voltage`,
  `stlink_calculate_pagesize`, `write_buffer_to_sram`) that `usb.c` and
  `common_flash.c` both call - omitting it produces `wasm-ld: undefined
  symbol` link errors, not a compile-time signal, so it's easy to miss
  until link time.
- `init_chipids()` (`chipid.c`) `opendir()`s/`readdir()`s a real directory
  looking for `*.chip` files, exactly like the real CLI does against
  `vendor/stlink/config/chips/` (~34KB across 80 files, STM32 chip
  definitions). This repo's `--embed-file` (not `--preload-file`) bakes
  that directory straight into the `.wasm` binary's data segment - see the
  next section for why `--preload-file`'s separate `.data` file doesn't
  work here.

### `vite.config.ts` now exists - here's why

This repo had no `vite.config.ts` before this feature. Two independent
problems both landed on the same fix:

1. **`--preload-file` doesn't work with this project's build**:
   Emscripten's `--preload-file` emits a companion `.data` file, fetched at
   runtime by the generated `.mjs` - but `npm run build` (Vite) only knows
   to copy the `.wasm` alongside a dynamically-`import()`ed `.mjs`
   (a recognized default asset extension); a novel `.data` extension
   referenced only via a runtime `fetch()` call inside that `.mjs` is
   invisible to Vite's static asset analysis, so a production build would
   silently ship without the chip database. Fixed by switching to
   `--embed-file` instead (see above) - the chip data is small enough
   (~34KB) that embedding it directly in the `.wasm` sidesteps the whole
   problem, rather than teaching Vite about a new asset type.
2. **A local `.emtoolchain/` emsdk install (this file's own documented
   convention, see "Requires the Emscripten SDK" above) crashes `npm run
   dev`/`npm run test:e2e` with `ENOSPC: System limit for number of file
   watchers reached`** - a full Emscripten SDK install is tens of thousands
   of files, and Vite's dev-server watches the whole project root by
   default. This is pre-existing latent breakage in the documented
   `.emtoolchain/`-inside-the-repo convention, not something introduced by
   this feature - it just took someone actually having `.emtoolchain/`
   present *and* running the dev server to surface it. Fixed by adding
   `vite.config.ts` with `server.watch.ignored: ["**/.emtoolchain/**"]`.
   Since this file didn't exist before, double-check any future
   `vite`-level customization lands here rather than assuming Vite's bare
   defaults still apply project-wide.

### Built-in release catalog (added 2026-08-18)

Both flashing pages (Build & flash's Flash panel, and this page) can now
also load firmware from a dropdown of built-in releases instead of always
browsing for a file. The releases themselves are never duplicated into this
app - `releases/motor/` and `releases/display/` (repo root, split
2026-08-19 - motor used to be `releases/` itself, see "Releases folder
reorganized" further down) stay the one place they're maintained. The
plumbing: `public/releases` is a symlink to `../../releases` (so Vite serves
the real files as static assets, dereferenced into real files at build time
- confirmed via a real `npm run build` + inspecting `dist/releases/`, not
just assumed), and `firmware-manifest-plugin.ts` (a small Vite plugin, not
part of `src/` since it runs in Node, not the browser) serves/emits
`releases/motor/manifest.json` and `releases/display/manifest.json` - a
JSON array of filenames (`.hex` for motor and SW102, `.hex`+`.bin` for the
display folder overall, since 860C/850C take a raw `.bin` - see the UART
section above), computed fresh from whatever's actually on disk each time
(dev: a server middleware; build: `generateBundle()`), never checked into
source. `src/firmware-catalog.ts` is the browser-side client for those two
manifests plus the release files themselves.

### Verification status

Compiles clean, links clean (after the `common_legacy.c` fix above), the
built module loads correctly under Node with all 80 chip files present in
its virtual FS (confirmed by direct inspection, not just "no error thrown"),
and both `stm32_flash_write_hex()`/`nrf51_flash_write_hex()` correctly reach
real ST-Link protocol traffic and fail gracefully (not a crash/hang) when no
real device is attached. The UI itself was verified against a real running
dev server via Playwright: the "Display firmware" nav tab renders distinctly
from "Build & flash", both cards render, the target dropdown has all 4
options, zero console errors. `npm run preflight` (typecheck/lint/format,
43 unit tests, 3 e2e scenarios) passes clean.

**What is NOT yet verified**: an actual flash against real 860C/850C or
SW102 hardware. Everything above rules out whole classes of bugs (build
breaks, link errors, malformed enumeration, wrong endpoint/protocol
selection, UI wiring) but the real SWD wire behavior - timing, the NVMC
routine's correctness against real Nordic silicon, whether stlink-org's
FPEC path handles this specific STM32F103 variant/bootloader configuration
correctly - can only be confirmed by actually flashing a board and checking
it boots. Do that before trusting this beyond "the code path executes."

## 860C/850C now flash over UART, not SWD (added 2026-08-19)

The SWD path above (`flashStm32Hex`) turned out to be impractical on real
860C hardware: its SWD pins aren't reachable without opening a sealed case
(confirmed via the OpenSourceEBike wiki - see
`../UNIVERSAL_FIRMWARE_PLAN.md`'s "Open / ongoing" section for the full
citation trail). The real-world flashing method for these two displays is a
**UART bootloader**, reached through the display's own 5-pin
motor-controller connector (a generic USB-UART adapter, not a debug probe) -
fully reverse-engineered and hardware-verified by a third party, documented
in a local `Color_LCD_860C` clone (`docs/bootloader-uart-protocol.md`), and
now reimplemented from scratch in this repo (clean-room against the
documented protocol facts, not transliterated from that clone's Python
reference - it carries no LICENSE file):

- `src/serial.d.ts` - hand-written Web Serial ambient types (TS's bundled
  DOM lib doesn't ship Web Serial, same situation `webusb.d.ts` solves for
  WebUSB).
- `src/uart-transport.ts` - `connectUartAdapter()`/`disconnectUartAdapter()`,
  mirroring `usb-transport.ts`'s shape but over `navigator.serial` instead of
  `navigator.usb` - a materially different, independent browser permission
  and device model (a generic CDC-ACM adapter, not a fixed ST-Link VID/PID).
- `src/uart-flasher.ts` - `buildBootloaderBlock()`/`buildBootloaderBlocks()`
  (pure, unit-tested in `src/__tests__/uart-flasher.test.ts`) and
  `flashUartBin()`, which does the real handshake (poll `0x5A` until `0xA5`
  ready) and per-block ACK/NAK-retry loop against an open `SerialPort`. Takes
  a raw `.bin` (`ArrayBuffer` -> `Uint8Array`), not Intel HEX - the
  bootloader's block addressing is a fixed protocol constant, not derived
  from hex address records, so there's nothing for a hex parser to get
  right or wrong here.
- `render/display-flash-page.ts` now branches on `state.displayTarget`:
  860C/850C/850C_2021 render the new UART panel (`renderUartFlashPanel`);
  SW102 still renders the original ST-Link/SWD panel
  (`renderSw102FlashPanel`) unchanged, since SW102's SWD use is a one-time
  bootloader+softdevice bootstrap on blank hardware, not a repeat/update
  path (its regular updates are Bluetooth DFU - a third transport, Web
  Bluetooth, not implemented here).
- `flashStm32Hex()` (`display-flasher.ts`) is **no longer called from the
  UI** - kept in place, unused, as a possible future advanced/recovery
  building block. The UART protocol's bootloader-region write-protection
  (see the plan doc's `+0x1000` address-field note) means it can never
  overwrite its own bootloader, so an SWD-based recovery path from a bad
  UART flash remains meaningful in principle even though it's not wired up.

**Not yet verified against real hardware** - same caveat as the rest of this
section: builds, typechecks, lints, and the pure block-layout logic is unit
tested, but the live serial handshake/ACK-NAK/retry loop has not been run
against a real 860C, because the user doesn't have one in hand yet. Test
this for real as soon as it arrives, same "flash and confirm it boots"
validation bar as everything else in this project.

## WebUSB fallback for the UART flash path, for Android (added 2026-08-29)

Android Chrome exposes `navigator.serial` (Chrome 126+), but that alone
doesn't mean `connectUartAdapter()` above can actually open a real adapter
there: Web Serial only attaches to a device the OS kernel has already turned
into a tty via a bound driver, and Android ships no such driver for the
vendor-specific chips these adapters use (Silicon Labs CP210x, WCH CH340,
FTDI) - unlike desktop Linux/Windows/macOS, which all have one. The API
being present is not proof the device will open; there's no capability check
that distinguishes the two, so this isn't something to auto-detect and
silently switch on - `webSerialAvailable()` still means exactly what it says
("this browser has the API"), nothing more.

`connectUartAdapterViaWebUsb()` (`uart-transport.ts`) is the real Android
path: same model as `usb-transport.ts`'s ST-Link connection - talk to the
raw, driver-unclaimed USB device directly via WebUSB, which needs nothing
from the OS beyond USB host mode. Rather than reimplementing the CP210x/
CH340/FTDI vendor wire protocols from scratch (each is genuinely
undocumented-by-the-vendor, reverse-engineered-from-Linux-driver-source
territory), this vendors `webusb-serial.js` from
[Jason2866/WebSerial_ESPTool](https://github.com/Jason2866/WebSerial_ESPTool)
(MIT; also published as the `tasmota-webserial-esptool` npm package) as a
git submodule at `vendor/webserial-esptool` - a known-good implementation
another project already built and hardware-verified for the identical
problem (browser-based ESP flashing over USB-OTG on Android). It covers
CP210x, CH340, FTDI, and a generic CDC/ACM fallback (the last one meaning a
CDC-mode WCH CH342/CH343/CH344/CH9101/CH9102/etc adapter - a genuinely
driverless, standard-class chip - would actually work over *plain* Web
Serial on Android too, no fallback needed; recommend one of those for any
new adapter purchase). Zero build step: it's already a browser-ready ES
module, unlike every other `vendor/` submodule in this project which needs
Emscripten - so there's no `wasm-*/build.sh` here, just a single dynamic
`import()` in `connectUartAdapterViaWebUsb()`, which Vite code-splits into
its own ~14KB chunk (confirmed via `npm run build`) so desktop users never
download it.

`webusb-serial-vendor.d.ts` declares only the four members actually called
(`WebUSBSerial.requestPort()` static, `readable`/`writable`/`open()`/
`close()`) - the vendored file ships no `.d.ts` and isn't a TS project, same
"don't hand-maintain more than needed" precedent `webusb.d.ts` already sets
for `wasm/build.sh`'s generated `*.mjs` output. `WebUSBSerial` isn't declared
to *implement* `SerialPort` (`serial.d.ts`) anywhere - it's cast to it
(`as unknown as SerialPort`) at the one call site, relying on the two being
structurally compatible for the members `uart-flasher.ts`'s
`flashUartBin()` and `motor-handshake.ts` actually touch (just
`readable`/`writable`/`open()`/`close()`), which is why neither of those
files needed any change.

UI (`render/display-flash-page.ts`): the old single connect/disconnect
toggle button became two explicit connect buttons - "Connect UART adapter…"
(Web Serial, gated on `webSerialAvailable()`) and "Connect UART adapter via
WebUSB (Android)…" (gated on `webUsbAvailable()`, imported from
`usb-transport.ts` rather than duplicated) - shown side by side whenever
both APIs exist (true on desktop Chrome too), collapsing to whichever one
the browser actually supports. Disconnecting is transport-agnostic
(`disconnectUartAdapter()` just calls `port.close()` either way) so there's
still only one disconnect button once connected. The panel's top-level
"not available" gate now only fires when *neither* API exists.

**Verified**: `npm run preflight` passes clean (typecheck/lint/format, 54
unit tests, 3 e2e scenarios - none of which exercise this new path directly,
see e2e/run.ts's own header comment on why real WASM/WebUSB flows aren't
covered there). Manually confirmed via a real dev server + Playwright: both
connect buttons render (headless Chromium exposes both `navigator.serial`
and `navigator.usb`), the informational Android/WebUSB subtitle renders,
clicking "Connect UART adapter via WebUSB (Android)…" actually loads the
vendored module and reaches real `navigator.usb.requestDevice()` (rejects
with "No device selected" in this device-less sandbox, surfaced cleanly
through the existing `state.uartConnectionError` UI, zero console errors).
**Not yet verified against a real Android phone + adapter + display** - that
real-hardware combination doesn't exist in this dev environment; test that
combination for real before trusting it, same bar as the UART path itself
above.

**Built-in release catalog for 860C/850C added same day**, once it became
clear the UART flow's raw-`.bin` requirement removed the old blocker (an
ambiguous load address for a `.hex` file) that had left `releases/display/`
empty for these targets - see `../UNIVERSAL_FIRMWARE_PLAN.md`'s "Open /
ongoing" section and `releases/display/README.md` for what's actually in
there and where it came from (5 real prebuilt `.bin` files copied from
emmebrusa/Color_LCD_860C's own releases, including 3 genuinely different
860C board-pinout variants - flagged with an in-UI warning so the wrong one
doesn't get flashed by accident).

## Releases folder reorganized (2026-08-19)

`releases/` (repo root) split into `releases/motor/` and `releases/display/`
- previously motor `.hex` files and `releases/backup/` sat directly at
`releases/` top level, display files in a `releases/display/` sibling; now
both are siblings under one consistent shape (`releases/motor/*.hex`,
`releases/motor/backup/`, `releases/display/*`). Served URLs moved to match
disk layout exactly: `/releases/motor/manifest.json` and
`/releases/motor/<name>` (previously `/releases/manifest.json` and
`/releases/<name>` - `firmware-catalog.ts`'s `fetchMotorReleaseCatalog()`/
`loadMotorRelease()` updated accordingly), `/releases/display/*` unchanged.
`releases/motor/backup/` also had two near-duplicate stock-firmware backup
sets pruned to one during this move (`sha1sum` confirmed the flash and opt
bytes were byte-identical across both timestamps; only the EEPROM bytes
differed, consistent with the user's own account of settings drift before
either backup was taken) - kept the earlier timestamp
(`...-20260802-134202.bin`), removed the later duplicate set.

## Display UI sim - runs the real 860C UI in a canvas (added 2026-08-19)

New "Display UI sim" nav page (`render/display-sim-page.ts`, `DISPLAY_SIM_PAGE`
in `app-state.ts`) compiles the display's real, unmodified UI logic to WASM
and runs it in a `<canvas>` against fake telemetry - a way to iterate on
look/feel (colors, layout, fonts) without flashing real hardware, ahead of
an eventual full UI rewrite. Nothing about motor communication is touched
or exercised.

- `wasm-display-sim/build.sh` + `sim_glue.c` compile
  `../../../firmwares/display/860C/`'s (vendored from Color_LCD_860C as a
  snapshot, not a submodule - see its README.md)
  `common/src/{buttons,configscreen,eeprom,fonts,
  mainscreen,screen,state,ugui,utils}.c` (fault.c excluded - same ARM-asm
  reason as the SWD-flasher build, see the WASM build note above) plus
  `860C_850C/src/{mainscreen-850,battery_gui}.c` (the 860C-specific
  layout/battery-icon completions - `mainScreen1`/`mainScreen2`'s actual
  field layouts live here, not in the shared file) - real source, targeting
  `DISPLAY_860C_V13`.
- `shim-include/` fakes only what a browser genuinely has no equivalent
  for: `pins.h`/`stm32f10x*.h` (buttons.c's raw GPIO read - `sim_glue.c`'s
  `GPIO_ReadInputDataBit()` maps the fake port tags to `sim_set_button()`
  state). Notably, `main.h`/`lcd.h`/`timers.h` (860C_850C/src's real files,
  added to the include path) turned out to need **no shim at all** - like
  `ugui_driver/ugui_display_8x0c.h`, they're declarations-only; only the
  handful of functions common/src code actually *calls* from them need
  stub bodies in `sim_glue.c` (`eeprom_hw_init`/`flash_read_words`/etc.,
  `rtc_get_time`/etc., `lcd_power_off`, `Display850C_rt_processing_*`).
  Mixing a real header for one file (`860C_850C/src/mainscreen-850.c`,
  same-directory quote-include priority) with a shim for the same header
  name reached transitively from elsewhere (`common/src/*.c` via
  `eeprom.h`) causes a duplicate-definition compile error in whichever
  file pulls in both paths - solved by not shimming `lcd.h`/`main.h` at
  all, letting every file resolve to the one real copy consistently.
- ugui's drawing is entirely `pset`-based when no hardware accelerator is
  registered (confirmed by grep - `UG_FillFrame`/`UG_DrawLine`/etc. all
  fall back to calling `gui->pset` in a loop), so `sim_glue.c` only needs
  to implement one pixel callback (`sim_pset`, writing into a static
  framebuffer) - no need to replicate the real driver's `HW_FillFrame`/
  `HW_DrawLine`/`HW_FillArea` acceleration hooks.
- **Non-obvious runtime traps found so far**, all by a real crash/blank
  render or a visibly wrong pixel, not by reading:
  1. `state.c`'s `copy_rt_to_ui_vars()` overwrites most telemetry-shaped
     `ui_vars` fields from `rt_vars` every 100ms (`mainscreen.c`'s
     `screen_clock()`, unconditionally, whether or not a real UART packet
     ever arrives) - a `sim_set_*` function that pokes `ui_vars` directly
     gets silently clobbered back to 0 on the next cycle. Fixed by having
     every telemetry setter target the matching `rt_vars` field instead
     (the actual source of truth a real UART parse would populate) -
     confirmed field-by-field against `copy_rt_to_ui_vars()`'s own body.
     `ui8_assist_level` and the separate `ui8_g_battery_soc` global are the
     only two telemetry-ish fields *not* part of that copy, so those two
     stay direct `ui_vars`/global writes.
  2. `mainscreen.c`'s `wheel_speed()` deliberately zeros displayed speed
     until `state.h`'s `ui8_g_motorVariablesStabilized` flips - a real
     safety feature ("reset otherwise at startup this value goes crazy")
     that a real motor link takes ~5 real seconds of confirmed-good UART
     packets to set, via `state.c`'s `rt_first_time_management()`. That
     function (and `rt_graph_process()`, see #4 below) is normally called
     every 100ms from `860C_850C/src/timers.c`'s `rt_processing()` - a real
     hardware timer ISR, and `timers.c` isn't part of this build at all
     (see build.sh's own comment on why `mainscreen-850.c`/`battery_gui.c`
     are included but `timers.c`/`lcd.c`/etc. aren't). `sim_glue.c`'s
     `advance_tick()` calls `rt_first_time_management()` +
     `rt_graph_process()` itself, every 5th `sim_tick()` (100ms at the
     real 20ms cadence) - this now runs for real, not a shortcut. The one
     genuine sim-only substitution: `rt_first_time_management()`'s
     stabilization check also requires `g_motor_init_state` to already be
     `MOTOR_INIT_READY`/`MOTOR_INIT_SIMULATING`, which normally only
     happens via a real UART handshake this sim's fake UART
     (`uart_get_rx_buffer_rdy()` always returns NULL) can never complete -
     `sim_init()` sets `g_motor_init_state = MOTOR_INIT_SIMULATING`
     directly, which is a real, upstream-defined state built for exactly
     this ("If we are simulating received packets never send real
     packets" - state.c's own comment on it), not a bespoke hack.
  3. `motor_efficiency()` (`mainscreen.c`, called unconditionally every
     100ms) divides by `ui_vars.ui16_battery_power + ui_vars.ui16_pedal_power`
     with no zero guard - real hardware never actually has both at exactly
     0, but a freshly-booted sim with nothing driving those fields yet
     does. `sim_init()` seeds a small nonzero `rt_vars.ui16_battery_power_filtered`
     baseline rather than chasing every such zero-input edge case
     individually.
  4. The speed graph on mainScreen1 never accumulated any data at all
     until #2's fix above - `rt_graph_process()` (screen.c) only samples
     while `mainscreen.c`'s `activeGraphs` global is non-NULL, and that's
     only ever set inside `rt_first_time_management()`'s stabilization
     branch, which wasn't running before `advance_tick()` started driving
     it. Once real graph accumulation started working, a fresh boot still
     opened to a blank axis (one real point every 3.644s -
     `GRAPH_DATA_0_INTERVAL_MS` - and no accumulation at all for the first
     5 real seconds of stabilization) - `sim_init()` now warms up ~90
     simulated seconds through the exact same `advance_tick()` path,
     driving a sine-wave "test ride" through it, before handing control to
     the page's real sliders. Not a separate code path - the graph is
     genuinely, always live; this just front-loads some history so the
     card isn't empty on first paint.
  5. `sim_pset()` was missing the one special case every real hardware
     driver has (`860C_850C/src/ugui_driver/ugui_display_8x0c.c`, several
     spots): `if (c == C_TRANSPARENT) return;` - skip the write instead of
     drawing it as a literal color. Without that check, `screen.c`'s
     `UG_SetBackcolor(C_TRANSPARENT)` calls (used so text can be redrawn
     without erasing content it might slightly overlap - see its own
     comments) painted `C_TRANSPARENT`'s literal RGB565 bit pattern
     (`0xC1C2`, which decodes to a strong orange-red) as a real background
     fill - the reason odometer/human power/up time/motor power all showed
     a solid orange-red box behind their text before this fix.
  6. `rtc_get_time()` (top-right wall clock) and `rtc_get_time_since_startup()`
     ("up time" field) are two genuinely different counters in the real
     `860C_850C/src/rtc.c` - the former reads a settable RTC-peripheral
     counter, the latter a separate seconds-since-boot counter a real RTC
     ISR increments once a second. An earlier version of `sim_glue.c`
     backed both with one shared fake struct, so setting one (the sim
     page's `sim_set_wall_clock()`, driven by the browser's real
     `Date.now()`) silently also moved the other. Fixed by implementing
     both accessors' real formulas separately - `rtc_get_time()` off a
     `sim_rtc_counter_seconds` counter only `sim_set_wall_clock()` writes,
     `rtc_get_time_since_startup()` off `ui32_seconds_since_startup`,
     which `advance_tick()` now derives from `sim_ms_counter` every tick
     (in place of a real 1Hz ISR).
- `src/display-sim.ts` is the typed JS-side wrapper (mirrors `flasher.ts`'s
  `loadModule()` shape); `render/display-sim-page.ts` owns a 20ms
  `setInterval` tick loop (matching the real firmware's own `main_idle()`
  cadence) that self-cancels once its canvas leaves the document (checked
  via `canvas.isConnected` each tick - app-shell.ts has no unmount hook,
  since every nav click tears down and rebuilds the whole DOM).
- On-screen buttons and telemetry sliders (battery %, speed, cadence,
  assist level, human power, motor power, motor temp, battery voltage) are
  module-level page state, not `AppState` - same reasoning as
  `backup-flash-page.ts`'s `motorCatalog`: ephemeral simulator runtime
  state, not something that belongs in the saved config/session. The
  button pad is laid out to trace a capital "T" rotated 90° CCW onto its
  side (+/- stacked on the left, M and a power-symbol icon spanning full
  height beside them) - the real 850C/860C's own physical button layout,
  not an arbitrary grid. "Motor power" (slider label, and
  `display-sim.ts`'s `setMotorPower()`) is named for what the real UI
  displays this field as (`mainscreen.c`'s `batteryPowerField`,
  `_S("motor power", ...)`) rather than the firmware's internal name for
  the same value (`ui16_m_battery_power_filtered`) - the WASM/C side still
  calls it `sim_set_battery_power` to match the real variable name;
  only the outward-facing TS/UI layer renames it, with a comment bridging
  the two.
- The canvas is responsive (`width:100%; max-width:320px; height:auto;
  aspect-ratio:320/480`), not a fixed 320px - a fixed size clipped/
  overflowed horizontally on a phone (content-scroll padding + the card's
  own padding left less than 320px available). The card's border/padding
  are also dropped specifically on this page below 760px (see
  `display-sim-page.css`'s own media query - scoped to
  `.display-sim-layout.card`, not `.card` generally) to reclaim the rest.

**Live edit → recompile → see-it-in-the-sim loop**: `npm run
watch:display-sim` (`wasm-display-sim/watch.ts`) watches
`../../../firmwares/display/860C/**/*.{c,h}` and `wasm-display-sim/*.c`,
reruns `build.sh` on every save, and that's the whole trick - Vite's own
dev-server file watcher already picks up the rewritten
`src/wasm/display-sim.mjs` as a real source change and full-reloads any
open tab that imported it (WASM modules aren't hot-swappable, but the sim
boots fresh on load anyway, so a full reload is a non-issue). Confirmed
empirically end-to-end: changed a literal string in `mainscreen-850.c`
while the watcher and a sim tab were both running, saw it show up in a
screenshot a few seconds later with zero manual steps - not just "should
work" reasoning. Run it in its own terminal alongside `npm run dev`, needs
emsdk on `PATH` same as any other WASM rebuild. See README.md's "Display UI
sim (dev tool)" section for the contributor-facing version of this. The
former open question here - how a third-party submodule would accept
outside PRs long-term - is resolved as of 2026-08-19: `Color_LCD_860C` was
de-submoduled and vendored as an owned snapshot at
`firmwares/display/860C/` (see its README.md for provenance and the LVGL UI
rewrite this enables; `firmwares/display/SW102/` is a separate, independent
snapshot, untouched, still on the original µGUI stack).

**Verified against real button/telemetry interaction** via Playwright: the
real UI renders (battery bar, clock, assist level, speed, odometer, human/
motor power all show real values matching the sliders), pressing UP
navigates to the real graph screen (confirming the actual button-driven
screen-cycling logic runs, not just static rendering), zero console errors,
pause/resume genuinely freezes/resumes (byte-identical canvas while
"paused"), the live watch loop (edit → `watch:display-sim` rebuild → Vite
reload → new pixels on screen, no manual browser action) confirmed
end-to-end. Reviewed by the user (2026-08-19) for a first pass of look/feel
and iterated on: mobile clipping fixed, physical-button-shaped input pad,
field naming/graph-color/legend questions answered. This was the
scaffolding for the real UI revamp - see the "OSF Modern" LVGL theme
section below for where that work landed.

## "OSF Modern" LVGL dashboard theme (860C/850C) - all 5 screens real as of 2026-08-19

The actual UI revamp the sim above was built to iterate on. Lives in
`firmwares/display/860C/common/src/theme_osf_modern.c` (+ its own
`icons_osf_modern.c`/`.h` for vector status icons - see that file's own doc
comment for the SVG→LVGL-image pipeline used to generate them, a one-off
manual process, not a repeatable build step) plus the theme-registry
plumbing in `dashboard_theme.h`/`.c`, both under `common/`, so they compile
into both the real firmware (`860C_850C/src/Makefile`) and this sim
(`wasm-display-sim/build.sh`) identically - no doc for this existed until
now even though the work spans this whole session, so this section covers
all of it, not just today's slice.

**Architecture**: `dashboard_theme_t` (`dashboard_theme.h`) is a vtable of
`build_*`/`update_*` function pointers, one theme per struct
(`osf_modern_theme` is currently the only one -
`g_available_themes[]`/`g_available_themes_count`, keyed by EEPROM's
`ui8_active_theme_index`, so more themes can be added later without
touching the domain layer). `dashboard_theme.c` owns a small screen state
machine (`dashboard_screen_t`: BOOT → MAIN ⇄ GRAPH ⇄ CONFIG, plus a
terminal FAULT state) and `dashboard_theme_tick()`, called every ~20ms from
both real `main.c` and `sim_glue.c`'s `sim_tick()` - it rebuilds-and-loads
whichever screen the real domain layer's button/state logic asked for
(mainscreen.c's `screenShow()`, bridged into `g_lvgl_requested_screen`/
`g_lvgl_screen_on_press` since screen.c's own µGUI renderer is gone -
`ugui_shim.c`'s own doc comment has the full picture) and then calls that
screen's `update_*` every tick.

**All 5 screens are real, not placeholders**:
- **Main** - speed hero, battery/power side bars, assist-level card, a
  10-minute mini speed graph, motor-temp readout, and a real
  `Field`-backed trip A/B tile (mainscreen.c's real EEPROM-backed odometer
  trips). UP/DOWN buttons genuinely change assist level (bridged through
  `mainScreenOnPress()`, the same handler real `mainScreen1/2/3` share).
- **Graph** - full-screen 15-minute chart over the same real per-variable
  graph data mainscreen.c/state.c already accumulate, with MIN/AVG/MAX
  stat tiles.
- **Config** - a generic renderer walking configscreen.c's real Field/
  Screen menu tree (dozens of settings, several submenus deep) - the
  canonical config screen for every theme, not just this one (see
  `dashboard_theme.h`'s own doc comment on why).
- **Boot** (added 2026-08-19) - shows the wordmark/version and a live
  status line driven by the real motor UART handshake state
  (`state.h`'s `g_motor_init_state`), then hands off to Main once ready
  and the power button is released - real gating logic ported from
  mainscreen.c's old (now-dead, since screen.c's `onPreUpdate` mechanism
  no longer runs) `bootScreenOnPreUpdate()`. Any `MOTOR_INIT_ERROR*` state
  blocks here forever in red, matching real firmware's documented
  behavior - this doubles as the motor-side error screen, so there's no
  separate one for that case. A `BOOT_SCREEN_MIN_TICKS` (1.5s) minimum
  dwell exists purely so this sim can show it at all - `sim_glue.c` fakes
  an instantly-ready motor, which would otherwise skip this screen in a
  single 20ms frame; invisible on real hardware, where the handshake
  already takes longer than that on its own.
- **Fault** (added 2026-08-19) - the real crash/assert/hardfault/stack-
  overflow handler (`common/src/fault.c`'s `app_error_fault_handler()`,
  real-firmware-only - excluded from this sim build for the same ARM-asm
  reason noted above) now genuinely renders fault code/PC/info text
  instead of looping forever on a blank screen. Two stubs had to become
  real for this: `ugui_shim.c`'s `fieldPrintf()` (was a no-op - fault.c's
  dynamic fault text was being formatted and immediately discarded) and
  `panicScreenShow()` (now calls the new `dashboard_theme_show_fault()`).
  `fault.c`'s post-crash wait-for-reboot loop now also pumps
  `lv_timer_handler()` itself, since control never returns to `main()`'s
  own render loop once parked there. `faultCode`/`addrCode`/`infoCode`
  (the dynamic per-crash `Field`s fault.c writes into) are defined in
  `theme_osf_modern.c`, not `fault.c` - needed by both builds, but only
  writable from the real-firmware-only one. Verified in the sim via a
  temporary debug hook (`sim_glue.c` export calling the same
  `fieldPrintf()`/`dashboard_theme_show_fault()` path fault.c uses, since
  fault.c itself can't compile here) - added, screenshotted, then fully
  removed; not part of the shipped sim.

**Not yet verified against real hardware** - same standing caveat as
everything else in this doc: builds clean (native ARM firmware + WASM
sim), renders correctly in the sim via Playwright, but a real crash/
hardfault on actual 860C/850C hardware exercising the new fault-screen
render path has not been triggered and observed. Flash and confirm before
trusting it beyond "the code path executes correctly in simulation."
