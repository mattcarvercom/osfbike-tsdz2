# Display firmware releases

Pre-built display firmware files go here (not built in-browser - see
`../../UNIVERSAL_FIRMWARE_PLAN.md`'s Phase 3). Same convention as the parent
`releases/` folder: this is the one place these are maintained, symlinked
into `tools/web_configurator/public/releases/display` so the web
configurator's "Display firmware" page can offer them as built-in picks.

Two file types, one per flashing path:
- **`.bin`** - 860C/850C/850C_2021, flashed over the UART bootloader (see
  `tools/web_configurator/src/uart-flasher.ts`). Must be a **bootloader-resident**
  build (linked to load at `0x08005000`, 20 KiB above the base of flash) -
  the UART bootloader's own write-protection refuses to touch anything below
  that address, so a plain (non-bootloader, `0x08000000`-linked) `.bin` won't
  boot correctly here even though it'll happily transfer.
- **`.hex`** - SW102 only, flashed over ST-Link/SWD (see
  `tools/web_configurator/src/display-flasher.ts`'s `flashNrf51Hex`).

Two tiers, kept in physically separate locations so it's never ambiguous
which is which:

- **`legacy/`** - stock emmebrusa/Color_LCD_860C releases (untouched, kept
  under their own upstream naming): `<TARGET>-<version>.<ext>`, e.g.
  `legacy/860C-v20.1C.5-2-bootloader.bin`. Not ours to reinterpret - these
  are someone else's published version string, kept as-is for provenance.
- **This folder's top level** - this project's own current builds:
  `<TARGET>-<semver>[+<metadata>].<ext>`,
  e.g. `860C-1.0.0+V13.bootloader.bin`. No `v` prefix on the semver - this
  fork has diverged far enough from upstream to be its own project with its
  own version number (`common/Makefile.common`'s `DISPLAY_FIRMWARE_MAJOR/
  MINOR/PATCH`, currently `1.0.0`, still unreleased/alpha - see the repo
  root `CHANGELOG.md`), and a leading `v` would be ambiguous next to the
  860C's `V12`/`V13` board-revision codes. Those revision codes move into
  SemVer's build-metadata field instead (the `+`-prefixed part - by spec,
  info that doesn't affect version precedence, which is exactly what a pin
  mapping is), always alongside a `bootloader` identifier marking the
  bootloader-resident link address: `+bootloader`, `+V12.bootloader`,
  `+V13.bootloader`.

`TARGET` should match one of `860C`, `850C`, `850C_2021`, `SW102` (the
board itself, not a pin-revision variant) so it's obvious at a glance which
board a file is for - and so that page's `UART_RELEASE_MATCHERS` predicates
pick it up correctly. The picker's own target list
(`display-flash-page.ts`'s `TARGET_LABELS`) additionally splits 860C into
three separate selections - `860C_V13`, `860C_V12`, and plain `860C` (other/
unknown revision) - but that split lives entirely in `UART_RELEASE_MATCHERS`
matching against the `860C-`-prefixed filename's SemVer build-metadata
(`+V12`/`+V13`, or neither for the plain build); it doesn't change this
naming convention. The web configurator only pattern-matches on this, it
doesn't otherwise parse/enforce naming.

`firmware-manifest-plugin.ts` lists this folder's top level plus one level
into `legacy/` (reported as `legacy/<name>`, any *other* subfolder is
ignored) - the flash page strips that prefix back off for display and
target-prefix matching (`basename()`), and uses it to label each dropdown
entry `osf.bike` vs `emmebrusa` (`releaseSource()`). Any other release added
under `legacy/` in the future is picked up automatically, no code changes
needed there - only the actual folder placement decides the tier.

## `legacy/` - stock emmebrusa build (added 2026-08-19, moved into legacy/ 2026-08-21)

Copied directly from
[emmebrusa/Color_LCD_860C](https://github.com/emmebrusa/Color_LCD_860C)'s own
`releases/20.1C.5-2-860C/` (tag `v20.1C.5-860C-update-2`, the latest at the
time) - the same source this project's own web configurator links to/credits
elsewhere, publicly distributed by its author via GitHub and linked from the
endless-sphere OSF thread. `Color_LCD_860C` carries no LICENSE file of its
own, but is part of the same open, share-freely OSF ecosystem this fork
(GPLv3) already operates in, and is explicitly written/distributed for
end users to download and flash (see its README's install disclaimers).

- `legacy/860C-v20.1C.5-2-bootloader.bin`, `legacy/860C_V12-v20.1C.5-2-bootloader.bin`,
  `legacy/860C_V13-v20.1C.5-2-bootloader.bin` - **three genuinely different
  builds**, not duplicates. V12/V13 are different 860C board pinout revisions
  (`firmware/860C_850C/dumper/README.md` in the source repo: "V13 = V1.3/V1.5"
  is the more common/default one). Byte-diffed to confirm all three actually
  differ, not just renamed copies of one file. Flashing the wrong one for a
  given board won't just fail to boot - it may drive pins that board wires
  differently. If you don't already know which yours is, check before
  picking one.
- `legacy/850C-v20.1C.5-2-bootloader.bin`, `legacy/850C_2021-v20.1C.5-2-bootloader.bin`.

All five are the **bootloader-resident** build variant (the source repo also
publishes a plain, non-bootloader `850C_v20.1C.5-2-860C.bin` for at least
850C - deliberately not copied here, since it's the wrong load address for
this project's UART flasher). Moved into `legacy/` 2026-08-21, alongside the
manifest/picker changes to support that split - filenames themselves
unchanged, still emmebrusa's own upstream naming.

## This repo's own OSF Modern build - current tier

Lives at this folder's top level (not `legacy/`): `860C-1.0.0+bootloader.bin`,
`860C-1.0.0+V12.bootloader.bin`, `860C-1.0.0+V13.bootloader.bin`,
`850C-1.0.0+bootloader.bin`, `850C_2021-1.0.0+bootloader.bin` - built from
this repo's own `firmwares/display/860C/` (the OSF Modern LVGL theme,
`theme_osf_modern.c`), **not** the stock emmebrusa UI `legacy/` holds.

**Published as a public PR, not yet merged**: tracked as `mattcarvercom/osfbike-tsdz2`
PR #5 ("Display firmware 1.0.0 (RC): real-hardware bring-up") - builds clean, matches the
in-browser sim byte-for-byte in behavior as far as the sim can exercise it, and as of
2026-08-27 has actually been flashed and ridden on a real 860C (V13 board revision).
850C/850C (2021) share this same source but haven't had their own hardware pass yet -
don't merge or tag a release covering those two until they have. The motor `.hex` in
`../motor/` doesn't have this caveat - it's been flashed and ridden on real hardware.

Rebuild via:

```sh
cd firmwares/display/860C/860C_850C/src
export PATH="$(pwd)/../../../../../.arm-toolchain/bin:$PATH"   # see 860C_FROM_SOURCE_BUILD.md
rm -rf ../common && make -f Makefile clean
make -f Makefile DISPLAY_VERSION="860C_V13_BOOTLOADER"   # or 860C_BOOTLOADER, 860C_V12_BOOTLOADER, 850C_BOOTLOADER, 850C_2021_BOOTLOADER
# -> main.bin
```

Board pinout revision matters for 860C (see the warning in the `legacy/`
section above) - confirm which V12/V13/plain your board is before flashing.
