# 860C display firmware: building from source (investigation, 2026-08-19)

> **Update (2026-08-19, later same day)**: the reorg this doc's "Why this exists"
> section calls "longer-term" and "deliberately deferred" has now happened - the
> `Color_LCD_860C` submodule was removed and its source vendored as a snapshot at
> `firmwares/display/860C/` (+ a separate, independent `firmwares/display/SW102/` copy for
> SW102), with the two build-fix workarounds below folded in permanently (see
> `firmwares/display/860C/README.md` for the fixed-in-place source and provenance). The
> investigation and its findings below are otherwise still accurate - the build recipe's
> paths have been updated to match.

Full record of adding `emmebrusa/Color_LCD_860C` as a submodule, getting a
from-source 860C build working, and investigating why it doesn't byte-match
the official prebuilt `.bin`. Written so a fresh session (after `/compact`
or otherwise) can pick this up without redoing the investigation.

## Why this exists

Longer-term goal (user's own words): eventually reorganize this repo's
firmware sources into something like `firmwares/motor/tsdz2/src`,
`firmwares/display/860C/src` - a real "one-stop-shop" monorepo. Not done
yet, deliberately deferred ("that can come later").

Immediate, narrower goal that prompted this investigation: get an
in-repo, from-source 860C build working now, using a git submodule (not a
vendored/copied tree) specifically so upstream changes never need
cherry-picking - a submodule is a pinned reference, not a copy. Once the
user eventually rewrites the 860C UI, the submodule gets repointed at their
own fork instead (a one-line `.gitmodules` URL change), and upstream
tracking stops mattering at that point.

As a sanity/reproducibility check once a build worked, the user asked to
hash-compare the from-source output against the official prebuilt `.bin`
files already committed in `releases/display/` (see
`UNIVERSAL_FIRMWARE_PLAN.md`'s "Open / ongoing" section and the
`project_tsdz2_860c_swd_vs_uart_risk`/`project_tsdz2_860c_from_source_build`
memory files for how those prebuilts got there - a separate, earlier piece
of work this session: 5 `.bin` files copied from
`Color_LCD_860C/releases/20.1C.5-2-860C/` into this repo's own
`releases/display/`, wired into the web configurator's UART-flashing
catalog).

## Current state (as of this write-up)

- **Submodule added**: `git submodule add
  https://github.com/emmebrusa/Color_LCD_860C.git Color_LCD_860C` at repo
  root (not under `tools/web_configurator/vendor/` - that's for build
  *tools* like sdcc/stm8flash/stlink; this is firmware *source*, a
  different category, and matches where the user's eventual reorg implies
  it should live - top-level, not nested under the web tool).
- **Pinned commit**: `51cfddda826e3b1870981a8b75b91bc3d39d4471` = tag
  `v20.1C.5-860C-update-2` - deliberately the same release whose `.bin`
  files are already in `releases/display/`, so source and
  prebuilt-for-comparison line up by design.
- **Submodule working tree is clean** - every local edit made during this
  investigation (see below) was reverted after testing. Matches this
  repo's zero-local-patches convention for its other submodules
  (`vendor/sdcc`/`vendor/stm8flash`/`vendor/stlink`/`vendor/mcpp`).
- **ARM GCC 4.9.3 (2015q3) toolchain installed** at `.arm-toolchain/` (repo
  root, gitignored automatically by the existing blanket `.*` rule in
  `.gitignore` - same mechanism `tools/web_configurator/.emtoolchain/`
  already relies on for the emsdk install, no `.gitignore` edit needed).
  Source: still-live Launchpad archive,
  `https://launchpad.net/gcc-arm-embedded/4.9/4.9-2015-q3-update/+download/gcc-arm-none-eabi-4_9-2015q3-20150921-linux.tar.bz2`
  (73,710,332 bytes). This is the exact version the Makefile hardcodes
  (`-L/usr/lib/gcc/arm-none-eabi/4.9.3/armv7-m`) and the same one the
  sibling `SW102_LCD/firmware/SW102/README.md` already pointed to for that
  target. **Toolchain is intact and untouched** - a `ld`/`as` swap done
  mid-investigation (see below) was fully reverted; `.arm-toolchain/`
  currently has the original 2015 binaries in place.

## How to reproduce a build

```sh
cd firmwares/display/860C/860C_850C/src
export PATH="$(pwd)/../../../../../.arm-toolchain/bin:$PATH"   # adjust ../ count to wherever you are
make -f Makefile clean
rm -rf ../common   # clears out-of-tree common/*.o build byproducts from a previous build, if any
make -f Makefile DISPLAY_VERSION="860C_V13_BOOTLOADER"
# -> main.bin
```

(Fixes below are now applied permanently in `firmwares/display/860C/` - no working-tree
edits needed to reproduce this.)

`DISPLAY_VERSION` values (from the Makefile): `850C_BOOTLOADER`,
`850C_2021_BOOTLOADER`, `860C_BOOTLOADER`, `860C_V12_BOOTLOADER`,
`860C_V13_BOOTLOADER` (V12/V13 = different 860C board pinout revisions,
see `firmware/860C_850C/dumper/README.md` in the submodule - genuinely
different builds, not duplicates). `VERSION=` is accepted by the release
scripts (`firmware/release-*.sh`) but **never actually referenced anywhere
in the Makefile** - confirmed by grep, a harmless no-op. The embedded
version string (`VERSION_STRING`) is instead a hardcoded literal in
`firmware/common/Makefile.common`, checked into source at whatever commit
you build from - not derived from anything build-time.

**This will not build as-is** - see the two workarounds below, required to
get past a compile error and a link error, in that order.

## Two build-blocking bugs found (both real, both toolchain-version-independent - see the deep dive below)

### 1. `fault.c`: `.syntax divided` never gets reset, corrupts the rest of the file's assembly

`firmware/860C_850C/src/fault.c`'s `HardFault_Handler` ends its inline-asm
block with `".syntax divided\n"` and never restores `".syntax unified\n"`.
GNU `as` treats `.syntax` as sticky for the rest of the assembled file, so
GCC's own auto-generated code for the *very next* function
(`HardFaultHandlerC`'s epilogue, `adds r7, r7, #16`) gets parsed in
"divided" mode and rejected:

```
Error: instruction not supported in Thumb16 mode -- `adds r7,r7,#16'
```

Reproduced in complete isolation (a 3-line `.syntax divided` + any
3-operand-immediate Thumb2-only `ADD` alias fails identically, no other
project code involved). **Confirmed version-independent**: the exact same
error occurs with a brand-new (2025, GNU binutils 2.45.50) assembler, not
just the bundled 2015 one - see the deep dive.

**Fix tested** (applied only to the submodule working tree, never
committed): change the trailing `".syntax divided\n"` to
`".syntax unified\n"` in `fault.c`. Purely an assembler-directive scoping
fix - doesn't change any instruction inside the inline asm block itself,
only what mode the rest of the file gets parsed in afterward. Since GCC's
own default dialect for `-mthumb` Cortex-M targets is unified regardless of
what a `.syntax` directive claims, deleting the line entirely would have
the same effect - not tested separately, but trivially equivalent by
construction (both leave the assembler at "unified" from that point on,
matching what the block's own opening line already set).

There is a **second, unrelated file also named `fault.c`**
(`firmware/common/src/fault.c`, also compiled and linked in - shows up as
`_build/../../common/src/fault.o` in the link line). Checked it for the
same bug - it's a completely different implementation (SW102/Nordic-side
error-screen handling, `app_error_fault_handler`, no `.syntax` directives
at all, `grep` confirmed zero matches). Not a second instance of the bug.

### 2. `stm32_flash.ld`: this exact bundled `ld` can't parse `DEFINED()` inside a `MEMORY` region ternary

```
MEMORY
{
  FLASH (rx) : ORIGIN = DEFINED(USE_WITH_BOOTLOADER) ? (0x08000000 + 20K) : 0x08000000,
                LENGTH = DEFINED(USE_WITH_BOOTLOADER) ? (512K - 20K) : 512K
  ...
}
```

The bundled `ld` (2.24.0.20150921) rejects this outright:

```
stm32_flash.ld:45: nonconstant expression for origin
```

Reproduced in complete isolation (a 3-line test linker script +
`--defsym` fails identically). **This one is NOT version-independent** - a
modern `ld` (2.45.50, 2025) parses it fine (see the deep dive) - but the
bundled 2.24 genuinely cannot, full stop, regardless of any of this
project's own code.

**Fix tested** (working-tree only, reverted after testing, and not needed
if you swap in a modern `ld` instead - see deep dive): since every
`_BOOTLOADER` `DISPLAY_VERSION` target always sets `BOOTLOADER=yes` at
Make-eval time (a condition that's *always* true for any bootloader build
this Makefile can actually produce), hand-evaluate the ternary to its known
branch:

```
FLASH (rx) : ORIGIN = (0x08000000 + 20K), LENGTH = (512K - 20K)
```

Same numeric result the ternary was always going to produce for every
bootloader build - not a behavior change, just pre-computing a value the
bundled linker can't compute itself.

## Hash comparison: NOT byte-identical

Built `860C_V13_BOOTLOADER` (with both fixes above): `main.bin` =
**292,860 bytes**. Official prebuilt
`releases/display/860C_V13-v20.1C.5-2-bootloader.bin` = **296,210 bytes**.
~3.4KB (1.1%) smaller, diverges starting at byte 5 (inside the vector
table's Reset_Handler address field).

```
built:    15c6e495... (first attempt, wrong commit - see below)
built:    f8ae0a14... (correct matching commit, both link methods - see deep dive)
prebuilt: e84177ff...
```

## Deep dive: what was ruled out, and the leading theory

User asked to specifically check tags, branch history, and commit dates/
messages for where HEAD really was when the prebuilt was actually built,
and whether it might trace to a branch rather than a tag.

### Source-commit mismatch: ruled out

Initial build was from the submodule's pinned tip (`51cfddda`, tag
`v20.1C.5-860C-update-2`). But `git log --follow` on the exact prebuilt
`.bin` file shows its last-touching commit is `0049127e`
("v20.1C.5-update-2", 2026-05-31) - an **ancestor** of `51cfddda`
("Fixed the voltage display bug", 2026-07-02, a 1-line change to
`mainscreen.c` - nowhere near enough to explain a 3.4KB gap on its own).

Checking the *tag itself* against dates deepened this: `git log -1
<tag>` shows `v20.1C.5-860C-update-2` sitting on `51cfddda`, dated over a
month *after* `0049127e` actually added the release folder. So the tag was
placed retroactively on whatever was HEAD when the maintainer decided to
formally tag that release line - not on the commit that built the
binaries. A real, useful finding on its own (don't trust this project's
tag-to-release-folder correspondence at face value), but doesn't explain
the byte gap.

Confirmed `0049127e` is a single atomic commit that changes real firmware
source (`mainscreen.c`, `state.c`, `eeprom.c`, `configscreen.c`,
`screen.c`, `utils.c`, `Makefile.common`, headers) *and* adds all 6 release
binaries together (`git show 0049127e --stat`) - so source and binary are
provably from the same tree, no staleness possible.

**Rebuilt directly from `0049127e`** (temporarily checked out, re-applied
both working-tree fixes, built, then reverted back to the pinned
`51cfddda` afterward) - **the same ~3.4KB gap persisted**. Source-commit
mismatch is not the explanation.

### Branches: ruled out

```
git branch -r
  origin/860C origin/alpha.5 origin/ble origin/communications_TSDZ2
  origin/configurations origin/master origin/motor_max_power
  origin/testing_coast_brake origin/throttle
```

`origin/860C` (the one name that looked promising) has its tip at
`a4db0863` (2020-03-13, "860C seems to work ok...") and `git merge-base
origin/860C master` returns that same commit - i.e. it's a pure ancestor
of master with **zero unique commits**, fully absorbed years ago. Checked
all other branches too (`alpha.5`, `ble`, `communications_TSDZ2`,
`configurations`, `motor_max_power`, `testing_coast_brake`, `throttle`) -
all abandoned 2020-era WIP branches (`git log --oneline master..origin/<b>`
shows 1-6 unique commits each, all dated 2020, none touching anything
relevant). Nothing here traces to the 2026 release timeframe at all.

### Linker/binutils version: empirically ruled out

Downloaded a completely modern binutils - `apt-get download
binutils-arm-none-eabi` (no sudo needed for download; resolved to
`2.45.50.20251209-1ubuntu1+23build1`), extracted directly with `dpkg-deb -x`
(no install needed either). Relinked the *exact same* `.o` files (compiled
once, from the matching `0049127e` commit, with both fixes applied) through
it instead of the bundled 2015 `ld`.

Mechanics that mattered: `gcc -B <dir>` does **not** override GCC's own
same-prefix tool search (`gcc -print-prog-name=ld` still resolved to the
bundled one even with `-B` pointed at the modern binutils) - had to swap
the actual binaries in place instead (`.arm-toolchain/arm-none-eabi/bin/
{ld,as}`, backed up and restored after testing). Also needed
`-fno-use-linker-plugin` - the bundled 32-bit LTO plugin
(`liblto_plugin.so`) can't load into a 64-bit modern `ld`
(`wrong ELF class: ELFCLASS32`), even though this project doesn't use LTO
at all (collect2 tries to pass it regardless by default).

Two outcomes:
1. **The modern `ld` linked the real, unmodified `stm32_flash.ld`
   successfully** - no `DEFINED()` workaround needed, it just parses fine
   on a modern binutils. Confirms the hand-evaluated-ternary workaround was
   numerically correct either way (same result both ways).
2. **The output hash was byte-identical to the 2.24-linked build**
   (`f8ae0a14...` both times). Linker generation makes zero difference to
   this project's output, at least across this ten-year span.

### The real fork point: `fault.c`'s bug is not a toolchain-version artifact

Recompiled the **original, unpatched** `fault.c` (`.syntax divided` still
present, no fix applied) using the swapped-in modern (2025) assembler
instead of the bundled one - **identical failure**, same error, same line:

```
Error: instruction not supported in Thumb16 mode -- `adds r7,r7,#16'
```

Since neither a 2015 nor a 2025 mainline GNU assembler can build this file
as committed, "just needs a newer GNU toolchain" is conclusively wrong.
Whatever actually built the official releases was not a plain, later
version of the same GNU toolchain lineage.

**Leading theory, not confirmed further**: `stm32_flash.ld`'s own header
comment says `Environment: Atollic TrueSTUDIO(R)` - a commercial,
Eclipse-based ARM IDE (since folded into STM32CubeIDE, now discontinued as
a standalone product) that bundles its own GNU-ARM-Eclipse-derived
toolchain build, distinct from the plain upstream `gcc-arm-embedded`
Launchpad releases the SW102 README points to for that sibling target. A
vendor toolchain fork is the most plausible explanation for tolerating (or
differently handling) the `.syntax divided` construct in a way neither
mainline GNU generation does. **Not investigated further** - would mean
sourcing a specific, likely Windows-only, long-discontinued IDE installer
just to test a hunch; diminishing returns past this point without a
stronger lead.

## Where this leaves things

The from-source build is real, reproducible, and (once the `fault.c` fix
is applied) toolchain-generation-independent - same hash from a 2015 or a
2025 linker. That's a solid foundation for actually building this firmware
going forward, even though exact byte-parity with the specific committed
prebuilt likely requires sourcing the actual vendor IDE toolchain
(Atollic TrueSTUDIO or whatever GCC build it shipped) to fully close out -
not done, no immediate plan to.

Not decided/started:
- Whether to chase byte-parity further (source/try an Atollic TrueSTUDIO
  toolchain specifically; bisect which of the ~46 linked `.o` files
  actually differs in size between toolchain lineages, rather than
  reasoning about it in aggregate).
- Whether/how to fold this from-source build path into the web
  configurator itself (in-browser, WASM-ified, mirroring the motor
  firmware's SDCC pipeline) - not attempted this session, current work is
  native-build-only, run by hand in a shell.
- License/attribution check for `Color_LCD_860C` before shipping anything
  built from it - same open question already flagged for `ramb0t`'s fork in
  the UART-bootloader work (no LICENSE file exists upstream either way).
