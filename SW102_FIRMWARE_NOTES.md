# SW102 firmware - what's been learned

The SW102 is the third supported display (alongside 860C/850C), firmware
source at `firmwares/display/SW102/` (vendored as a snapshot from
`emmebrusa/Color_LCD_860C`, independent from `firmwares/display/860C/`'s own
copy - see `firmwares/display/SW102/README.md` for provenance, and
`860C_FROM_SOURCE_BUILD.md` for how the toolchain works, reused here
unchanged). This document covers two separate things: why the web
configurator doesn't offer SW102 flashing right now, and a from-source
build + OTA package generation done purely to confirm the toolchain works,
independent of that UI decision.

## Why SW102 isn't in the web configurator (2026-08-19)

Two different real firmware update paths exist for this display, and
neither is practically supported by a browser tool today:

1. **One-time SWD bootloader+SoftDevice bootstrap**, done once on blank
   hardware. This is what `flashNrf51Hex()`/the old `renderSw102FlashCard`
   UI targeted (ST-Link over WebUSB, same transport the motor flasher
   uses). The blocker: **there's no documented pinout anywhere in this fork
   (or its upstream) for where SWD's 4 signals (SWDIO/SWCLK/VCC/GND) are
   physically exposed on the actual SW102 PCB.** `firmware/SW102/TODO.md`'s
   "Misc notes from kevin" section only says generically "you have to
   connect the following 4 lines" with links to generic Nordic/OpenOCD
   Q&A threads - nothing board-specific. Compare this to 860C/850C, which
   have a real, documented, physically-accessible connector for their UART
   bootloader (the display's own 5-pin motor-controller connector) - SW102
   has no equivalent known entry point. In practice this most likely means
   opening the case and finding/soldering to test points on the board,
   which is a materially bigger barrier than "wire up a cable," and not
   something this project can respond to before actually having a unit in
   hand to probe.
2. **Regular firmware updates are Bluetooth DFU** (`nrfutil dfu ble`),
   confirmed via `firmware/SW102/README.md`. This is a genuinely different
   transport (Web Bluetooth, not Web Serial/WebUSB) that this tool doesn't
   implement at all.

Since the bootstrap step (1) has no known physical access path yet, and
the everyday update step (2) is out of scope regardless, there's currently
no working end-to-end flow to offer. The web configurator's Display
firmware page (`tools/web_configurator/src/render/display-flash-page.ts`)
now labels SW102 "(not supported yet)" in the target dropdown and renders
a short explanatory card instead of a flash UI - the old WebUSB/SWD flow
(`flashNrf51Hex()` in `display-flasher.ts`, and `loadDisplayRelease()` in
`firmware-catalog.ts` for its `.hex` release list) is left in place, unused,
as a dormant building block, same as `flashStm32Hex()` for the STM32-based
displays - not deleted, just not wired into the UI, in case a documented
SWD access point ever turns up.

**If/when SWD access is figured out** (e.g. the case has visible test
points, or an existing teardown documents them), this is one-time-per-unit
work, not per-update work - re-enable the old panel rather than rebuilding
it from scratch.

## Building SW102 from source (2026-08-19)

Independent of the UI question above: built the SW102 app firmware from
source and generated a real OTA update package, purely to confirm the
toolchain and pipeline work (not to compare hashes against a prebuilt -
not needed here, unlike the 860C from-source investigation).

### Prerequisite: fetch the nRF5 SDK (2026-08-21)

`SW102/Makefile`'s `SDK_ROOT` expects Nordic's nRF5 SDK v12.3.0 at
`firmwares/display/SW102/SW102/nRF5_SDK_12.3.0/` - **not committed to git**
(gitignored: it's a ~70MB zip / ~270MB unpacked third-party vendor tree,
unrelated to this project's own source changes). Fetch it once with:

```sh
firmwares/display/SW102/setup-sdk.sh
```

This downloads the official zip from Nordic, normalizes its CRLF line
endings, and applies `firmwares/display/SW102/nrf5-sdk-12.3.0.patch` - four
real local patches carried forward from what used to be committed directly
(found by diffing the old committed copy against a pristine download, not
just a size-prune): `app_uart_get()`'s declaration changed to match this
project's own `app_uart_fifo_mod.c`, a quoting fix in
`Makefile.common`/`Makefile.posix` so `GNU_INSTALL_ROOT` resolves correctly
on Linux, and a stack-canary-fill addition in the startup file for overflow
debugging (attributed inline to "kevinh"). A same-vintage `Makefile.windows`
diff (someone's personal Windows toolchain path) was deliberately dropped,
not carried forward - irrelevant to this build.

### Build

Same ARM GCC 4.9.3 (2015q3) toolchain already extracted for the 860C build
(`.arm-toolchain/` at repo root, gitignored - see `860C_FROM_SOURCE_BUILD.md`),
reused as-is:

```sh
cd firmwares/display/SW102/SW102
export GNU_INSTALL_ROOT=$(git rev-parse --show-toplevel)/.arm-toolchain
make -f Makefile clean_project
make -f Makefile GNU_INSTALL_ROOT=$GNU_INSTALL_ROOT
```

Re-verified 2026-08-21 against the gitignored/fetched SDK (previous
committed-SDK builds and this one produce the same result) - compiled and
linked clean, with one exception:
**the exact same `DEFINED(...)` ternary-in-MEMORY-region bug** already
found and documented for 860C's `stm32_flash.ld` (`860C_FROM_SOURCE_BUILD.md`)
also exists in `gcc_nrf51.ld` (`ORIGIN`/`LENGTH` for both `FLASH` and `RAM`
use the same pattern) - same root cause (the bundled `ld` 2.24 can't parse
`DEFINED()` inside a `MEMORY` region expression), same fix (hand-evaluate
the ternary to its always-true `USE_WITH_BOOTLOADER` branch, since the
Makefile always defines it). **Now folded in permanently** in
`firmwares/display/SW102/` (see its README.md) - originally applied as a
working-tree-only edit and reverted after each build, back when this was a
pristine submodule. Confirmed the reason USE_WITH_BOOTLOADER is always true
here: `Makefile` unconditionally sets `USE_WITH_BOOTLOADER = true` (never
built as a standalone/no-bootloader image in this project).

Result: `_build/nrf51822_sw102.hex` (244,665 bytes) and
`_build/nrf51822_sw102.bin` (86,956 bytes).

### Generating the OTA package

This required real work, all outside this repo (a local Python venv, not
committed): `firmware/SW102/Makefile`'s `generate_dfu_package` target shells
out to `nrfutil pkg generate`, the legacy Nordic Python DFU tool (not the
newer Rust-based nRF Util CLI - this project's Makefile predates that).

**`nrfutil` had to be installed and then hand-patched to run under modern
Python at all** - the last PyPI release of the legacy package, `nrfutil
5.2.0`, is riddled with Python-2-only code that was apparently never
actually exercised under Python 3 for this exact code path (hex/bin
conversion + protobuf init-packet + manifest generation). Every fix below
was a genuine `NameError`/`AttributeError`/`TypeError` hit in sequence, not
speculative:

```sh
python3 -m venv .sw102-venv        # gitignored, at repo root
source .sw102-venv/bin/activate
pip install nrfutil                # resolves to 5.2.0
```

Patches applied directly to the installed package files under
`.sw102-venv/lib/python3.14/site-packages/nordicsemi/` (not vendored/
committed anywhere - this venv is a disposable local artifact; redo these
if the venv is ever recreated):

| File | Bug | Fix |
|---|---|---|
| `dfu/signing.py` | `c.encode('hex')` - Python 2's bytes-to-hex-string idiom, removed in Python 3 | Deleted the line entirely - its result (`sk_hex`) was already dead code, never used by the function's actual return value |
| `dfu/package.py` | `self.firmwares_data.iteritems()` | `.items()` |
| `dfu/intelhex/__init__.py` | `xrange(...)` (7 call sites) | `range(...)` |
| `dfu/intelhex/__init__.py` | `array.tostring()` (5 call sites) - removed in modern Python 3 | `array.tobytes()` |
| `dfu/nrfhex.py` | `xrange(...)` (1 call site) | `range(...)` |
| `dfu/nrfhex.py` | `(size + (word_size - 1)) / word_size` - relied on Python 2's int/int floor-division default | `//` (explicit floor division) |
| `dfu/intelhex/__init__.py` | `fobj.write(self._tobinstr_really(...))` - wrote a `str` to a file opened `"wb"` | Wrapped in the module's own already-correct `asbytes()` shim (it already imports `asbytes`/`asstr` from `.compat` for exactly this py2/3 split - this call site just used the wrong one) |
| `dfu/package.py` | `boot_validation_bytes_array.append('')` - `str` where a protobuf `bytes` field was needed | `b''` |
| `dfu/manifest.py` | `d.iteritems()` | `.items()` |

None of these are SW102-specific or firmware-specific - they're generic
bugs in `nrfutil`'s own Python 3 support for the hex-application +
protobuf-init-packet code path. Once patched, the build ran clean:

```sh
make -f Makefile GNU_INSTALL_ROOT=$GNU_INSTALL_ROOT generate_dfu_package
# -> _release/sw102-otaupdate-xxx.zip
```

### Result

`_release/sw102-otaupdate-xxx.zip` (87,598 bytes), containing:

```
manifest.json   (153 bytes)
nrf51822_sw102.dat   (141 bytes)  - init packet
nrf51822_sw102.bin   (86,956 bytes)  - application
```

**Structurally verified against a real published release** (extracted
`Color_LCD_860C/releases/v20.1C.4-2-860C/sw102-otaupdate-20.1C.4-2.zip` for
comparison): identical file set, identical filenames, identical
`manifest.json` content (byte-for-byte), `.dat` init-packet size matches
exactly (141 bytes both), `.bin` size is close but not identical (86,956 vs
87,284 bytes - expected, since the real release was built from a different
commit/version than the submodule's currently pinned tip). No hash
comparison was attempted (not needed here - unlike the 860C investigation,
there's no "does our from-source build match Nordic's own tooling" question
to answer, just "does this pipeline produce a well-formed package").

SHA-256 of this session's build outputs, for reference:

```
efd5a745d49c726dd51636026ac045f958975829ea006e29a4fd07257f041bfd  nrf51822_sw102.hex
a5b4dcb161ad1a4c2ce2bdd51108aeb3741413032a1b9d2f3f495d332ce8d7e6  nrf51822_sw102.bin
e6afb1e50366fb490ecd893de2ea099ce1a15334504f2bc564256789276a758c  sw102-otaupdate-xxx.zip
```

Submodule commit at build time: `51cfddda826e3b1870981a8b75b91bc3d39d4471`
(tag `v20.1C.5-860C-update-2`).

### What this proves and doesn't prove

**Proves**: the SW102 firmware builds cleanly from source with this
project's existing toolchain, and a real, structurally valid Bluetooth DFU
package can be generated end-to-end (once `nrfutil` itself is fixed to run
under a modern Python 3). This part of the pipeline is not blocked.

**Doesn't prove**: that the generated package actually flashes/boots on
real hardware (no SW102 in hand to test against), or that the
`sk_hex`-removal fix in `signing.py` has zero effect on anything downstream
(it's provably dead code in this one function as written, but worth a
second look if `nrfutil` behaves oddly elsewhere someday). Also doesn't
change anything about the SWD-access blocker above - generating an OTA
update package still requires a device already running the bootloader,
which still can't be reached without a documented pinout.

### Not wired into anything

This build was exploratory only - no artifacts from it were copied into
`releases/display/`, no code changes were made to the web configurator as
a result, and the `.sw102-venv` used to run `nrfutil` is local-only and
gitignored. If real OTA-package generation becomes something the web
configurator should offer (e.g. as an admin/build tool, separate from the
flash UI), start from this doc rather than re-discovering the same
`nrfutil` bugs.
