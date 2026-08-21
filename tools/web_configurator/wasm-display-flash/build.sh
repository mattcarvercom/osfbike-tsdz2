#!/usr/bin/env bash
# Compiles the vendored stlink-org/stlink sources + our SWD flash routines +
# our WebUSB shim to WASM. Requires the Emscripten SDK on PATH (see
# ../.emtoolchain or https://emscripten.org/docs/getting_started/downloads.html);
# run `source /path/to/emsdk/emsdk_env.sh` first.
#
# Output is committed to ../src/wasm/ rather than gitignored - same reasoning
# as ../wasm/build.sh: this app is meant to be cloned and run with
# `npm run dev`, and requiring every contributor to install Emscripten just
# to flash a display would defeat the point. Re-run this script (and commit
# the result) only when vendor/stlink is updated or this dir's *.c changes.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v emcc >/dev/null 2>&1; then
	echo "emcc not found on PATH - source emsdk_env.sh first" >&2
	exit 1
fi

STLINK=../vendor/stlink
OUT_DIR=../src/wasm
mkdir -p "$OUT_DIR"

# -DSTLINK_HAVE_DIRENT_H: normally set by stlink-org's CMakeLists via
# check_include_file(dirent.h) - we bypass CMake entirely (see the "Risks -
# spiked and resolved" section of the plan this was built from), so this has
# to be set by hand. Emscripten's MEMFS implements dirent.h, so this is
# correct, not a workaround.
#
# --embed-file (not --preload-file): init_chipids() (chipid.c) opendir()s/
# readdir()s a real directory looking for *.chip files, exactly like the
# real st-flash CLI - this bakes vendor/stlink's whole config/chips/ (all
# STM32 families it ships, ~34KB of text) directly into the .wasm binary's
# data segment, so init_chipids("/chips") finds them without any
# reimplementation. --embed-file, not --preload-file: the latter emits a
# separate .data file fetched at runtime, which needs the bundler to know
# to copy it alongside the .wasm/.mjs - this repo has no vite.config.ts, so
# Vite's default asset pipeline (which does already know to copy .wasm)
# doesn't pick up a novel .data extension, and a production `npm run build`
# would silently ship without it. Small enough (~34KB) that embedding
# outweighs the complexity of teaching Vite about a new asset type.
#
# STACK_SIZE=1048576: same defensive sizing as ../wasm/build.sh's stm8flash
# build (its ONLY_WRITE_DIFFS alloca() overflowing Emscripten's 64KB default
# stack) - chipid.c's chip-file parser and flash_loader.c's flash-loop logic
# have comparably deep call chains, so the same margin is applied here rather
# than waiting to rediscover the same class of crash.
emcc \
	-I generated \
	-I "$STLINK/inc" \
	-I "$STLINK/src" \
	-I "$STLINK/src/stlink-lib" \
	-I shim-include \
	-DSTLINK_HAVE_DIRENT_H \
	-DSTLINK_HAVE_SYS_MMAN_H \
	-DSTLINK_HAVE_SYS_TIME_H \
	"$STLINK/src/stlink-lib/usb.c" \
	"$STLINK/src/stlink-lib/common_legacy.c" \
	"$STLINK/src/stlink-lib/read_write.c" \
	"$STLINK/src/stlink-lib/common_flash.c" \
	"$STLINK/src/stlink-lib/flash_loader.c" \
	"$STLINK/src/stlink-lib/calculate.c" \
	"$STLINK/src/stlink-lib/chipid.c" \
	"$STLINK/src/stlink-lib/map_file.c" \
	"$STLINK/src/stlink-lib/md5.c" \
	"$STLINK/src/stlink-lib/lib_md5.c" \
	"$STLINK/src/stlink-lib/logging.c" \
	"$STLINK/src/stlink-lib/helper.c" \
	wasm_api.c \
	nrf51_nvmc.c \
	usb_bridge.c \
	-O2 \
	-sENVIRONMENT=web \
	-sASYNCIFY=1 \
	-sSTACK_SIZE=1048576 \
	-sMODULARIZE=1 \
	-sEXPORT_ES6=1 \
	-sEXPORT_NAME=createStlinkDisplayFlashModule \
	-sEXIT_RUNTIME=0 \
	-sALLOW_MEMORY_GROWTH=1 \
	-sFORCE_FILESYSTEM=1 \
	--embed-file "$STLINK/config/chips@/chips" \
	-sEXPORTED_FUNCTIONS=_stm32_flash_write_hex,_nrf51_flash_write_hex,_malloc,_free \
	-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,stringToUTF8,lengthBytesUTF8,FS \
	-o "$OUT_DIR/stlink-display-flash.mjs"

echo "Wrote $OUT_DIR/stlink-display-flash.mjs + stlink-display-flash.wasm"
