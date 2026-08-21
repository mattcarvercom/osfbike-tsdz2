#!/usr/bin/env bash
# Compiles SDCC's STM8 toolchain (preprocessor, compiler, assembler, linker)
# to WASM, matching the approach the 8bitworkshop project (sehugg/8bitworkshop)
# uses for Z80/6502: SDCC's driver normally spawns the assembler/linker as
# separate OS processes, which doesn't work under Emscripten, so each stage
# is built as its own standalone WASM module and orchestrated from JS
# instead (see src/sdcc-build.ts) - mirroring compileSDCC/assembleSDASZ80/
# linkSDLDZ80 in 8bitworkshop's src/worker/tools/sdcc.ts.
#
# Requires the Emscripten SDK on PATH (source emsdk_env.sh first) plus the
# usual native autotools build deps (autoconf, automake, libtool, bison,
# flex) and system zlib/boost headers (only needed to satisfy SDCC's own
# ./configure checks - not linked into the wasm output beyond zlib, which
# Emscripten provides its own port of via -sUSE_ZLIB=1).
#
# Output is committed to src/wasm/ for the same reason as wasm/build.sh:
# this app is meant to be cloned and run with `npm run dev`, not built by
# every user. Re-run this script (and commit the result) only when
# vendor/sdcc or vendor/mcpp are updated, or the emcc flags below change.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v emcc >/dev/null 2>&1; then
	echo "emcc not found on PATH - source emsdk_env.sh first" >&2
	exit 1
fi

VENDOR_SDCC="$(pwd)/../vendor/sdcc"
VENDOR_MCPP="$(pwd)/../vendor/mcpp"
BUILD_DIR="$(pwd)/.build"
OUT_DIR="$(pwd)/../src/wasm"
mkdir -p "$OUT_DIR"

# STM8-only port selection - cuts build time substantially versus SDCC's
# default of building every backend it ships. Some of these flag names
# aren't recognized by this configure.ac (silently ignored by autoconf),
# but stm8 is confirmed enabled either way - see ports.build after configure.
DISABLE_PORTS=(
	--disable-mcs51-port --disable-z80-port --disable-z180-port
	--disable-r2k-port --disable-r2ka-port --disable-r3ka-port --disable-tlcs90-port
	--disable-ez80_z80-port --disable-z80n-port --disable-r800-port --disable-gbz80-port
	--disable-ds390-port --disable-ds400-port --disable-hc08-port
	--disable-s08-port --disable-pic14-port --disable-pic16-port
	--disable-sm83-port --disable-pdk13-port --disable-pdk14-port --disable-pdk15-port
	--disable-pdk16-port --disable-mos6502-port --disable-mos65c02-port --disable-f8-port
	--disable-TININative
)

# Emscripten's sysroot ships neither zlib.h nor boost - zlib has a real
# Emscripten port (-sUSE_ZLIB=1); boost/graph is header-only so falling back
# to the host's /usr/include works, but MUST be -idirafter (lowest
# priority), not -I, or glibc's headers shadow Emscripten's own libc++ ones
# and produce unrelated compile errors (ambiguous strtold_l, isinf, etc).
EXTRA_CFLAGS="-sUSE_ZLIB=1 -idirafter /usr/include"

# SDCC's yacc-generated parser overflows Emscripten's default 64KB wasm
# stack on real input (crashes with "memory access out of bounds" deep in
# yyparse) - bump it well past what any of these 4 modules actually need.
LD_COMMON="-s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web -s ALLOW_MEMORY_GROWTH=1 -s INVOKE_RUN=0 -s STACK_SIZE=8388608 -s EXPORTED_RUNTIME_METHODS=FS,callMain -Oz"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "=== mcpp ==="
rsync -a --exclude='.git' "$VENDOR_MCPP/" "$BUILD_DIR/mcpp/"
(
	cd "$BUILD_DIR/mcpp"
	autoreconf -fi
	emconfigure ./configure --host=wasm32-unknown-emscripten --disable-shared CPPFLAGS="$EXTRA_CFLAGS" CFLAGS="$EXTRA_CFLAGS"
	cd src
	emmake make -j"$(nproc)" LDFLAGS="-s EXPORT_NAME=createMcppModule $LD_COMMON"
)
cp "$BUILD_DIR/mcpp/src/mcpp" "$OUT_DIR/mcpp.mjs"
cp "$BUILD_DIR/mcpp/src/mcpp.wasm" "$OUT_DIR/mcpp.wasm"

echo "=== sdcc (STM8 compiler driver) ==="
rsync -a --exclude='.git' "$VENDOR_SDCC/" "$BUILD_DIR/sdcc/"
# SDCC vendors an old config.sub that doesn't recognize "emscripten" as a
# valid OS ("Invalid configuration ... system emscripten not recognized") -
# swap in the current one autoreconf just generated for mcpp instead of
# patching or regenerating SDCC's own (much more involved) build system.
cp "$BUILD_DIR/mcpp/config/config.sub" "$BUILD_DIR/sdcc/config.sub"
(
	cd "$BUILD_DIR/sdcc"
	emconfigure ./configure --host=wasm32-unknown-emscripten "${DISABLE_PORTS[@]}" \
		--disable-ucsim --disable-device-lib --disable-packihx \
		--disable-sdcpp --disable-sdcdb --disable-sdbinutils \
		CPPFLAGS="$EXTRA_CFLAGS" CFLAGS="$EXTRA_CFLAGS"
	grep -q '^stm8$' ports.build || { echo "stm8 port not enabled - aborting"; exit 1; }
	cd src
	emmake make -j"$(nproc)" LDFLAGS="-s EXPORT_NAME=createSdccModule $LD_COMMON"
)
cp "$BUILD_DIR/sdcc/src/sdcc" "$OUT_DIR/sdcc.mjs"
cp "$BUILD_DIR/sdcc/src/sdcc.wasm" "$OUT_DIR/sdcc.wasm"

echo "=== sdasstm8 (STM8 assembler) ==="
(
	cd "$BUILD_DIR/sdcc/sdas/asstm8"
	emmake make -j"$(nproc)" LDFLAGS="-s EXPORT_NAME=createSdasstm8Module $LD_COMMON"
)
cp "$BUILD_DIR/sdcc/bin/sdasstm8" "$OUT_DIR/sdasstm8.mjs"
cp "$BUILD_DIR/sdcc/bin/sdasstm8.wasm" "$OUT_DIR/sdasstm8.wasm"

echo "=== sdldstm8 (STM8 linker) ==="
# sdas/linksrc fails to compile under modern GCC/Clang with the default C
# standard (K&R-style "extern VOID elf();" forward decl conflicts with the
# real "elf(int i)" definition - legal old C, hard error in new compilers)
# - needs -std=gnu89 to restore the old semantics.
(
	cd "$BUILD_DIR/sdcc/sdas/linksrc"
	emmake make -j"$(nproc)" sdcc-ldstm8 \
		CFLAGS="-std=gnu89 -pipe -DINDEXLIB -DUNIX -I. -I. $EXTRA_CFLAGS" \
		LDFLAGS="-s EXPORT_NAME=createSdldstm8Module $LD_COMMON"
)
# The linker binary is always named "sdld" internally (sdas/linksrc/Makefile
# builds sdldstm8 by literally `cp`-ing the generic "sdld" output - see its
# sdcc-ldstm8 target) - emcc bakes the *built* filename into the JS glue's
# locateFile("sdld.wasm") call, which doesn't track the cp'd rename, so it
# must be patched or the browser fetches a "sdld.wasm" that doesn't exist.
sed 's/"sdld\.wasm"/"sdldstm8.wasm"/g' "$BUILD_DIR/sdcc/bin/sdld" >"$OUT_DIR/sdldstm8.mjs"
cp "$BUILD_DIR/sdcc/bin/sdld.wasm" "$OUT_DIR/sdldstm8.wasm"

echo "=== device/include + device/lib/stm8 + device/lib runtime helpers ==="
# Static support files the firmware's own sources need at build time but
# that aren't part of this repo - SDCC's standard freestanding headers,
# its hand-written STM8 assembly runtime helpers (division, memcpy, etc),
# and the 5 generic (architecture-portable) C runtime helpers the STM8
# medium/reentrant model needs that aren't in the hand-written set (found
# reactively from "ASlink-Warning-Undefined Global" on a real build - see
# sdcc-build.ts for the full explanation). _startup.c in particular is not
# optional despite only ever showing up as a link warning, not an error:
# src/stm8/main.c unconditionally emits a `call ___sdcc_external_startup`
# in every STM8 program's compiler-generated boot preamble, before global
# init - omitting it left that call resolving to an undefined/placeholder
# address instead of the real 2-instruction stub. A real bug, worth fixing
# on its own, but NOT the explanation for the in-browser build's larger
# native-vs-in-browser mismatch - that gap persisted almost unchanged after
# this fix. See tools/CLAUDE.md for full status/next steps.
RUNTIME_DIR="$OUT_DIR/stm8-runtime"
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR/include" "$RUNTIME_DIR/include/asm/stm8" "$RUNTIME_DIR/include/asm/default" "$RUNTIME_DIR/lib-asm" "$RUNTIME_DIR/lib-c"
cp "$VENDOR_SDCC"/device/include/*.h "$RUNTIME_DIR/include/"
cp "$VENDOR_SDCC"/device/include/asm/stm8/*.h "$RUNTIME_DIR/include/asm/stm8/"
cp "$VENDOR_SDCC"/device/include/asm/default/*.h "$RUNTIME_DIR/include/asm/default/"
cp "$VENDOR_SDCC"/device/lib/stm8/*.s "$RUNTIME_DIR/lib-asm/"
for f in _divulong.c _modulong.c _muluchar.c _mulschar.c _startup.c; do
	cp "$VENDOR_SDCC/device/lib/$f" "$RUNTIME_DIR/lib-c/"
done

echo "Done. Wrote mcpp/sdcc/sdasstm8/sdldstm8 .mjs+.wasm and stm8-runtime/ to $OUT_DIR"
