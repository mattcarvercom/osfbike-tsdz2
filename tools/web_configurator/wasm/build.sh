#!/usr/bin/env bash
# Compiles the vendored stm8flash sources + our WebUSB shim to WASM.
# Requires the Emscripten SDK on PATH (https://emscripten.org/docs/getting_started/downloads.html);
# run `source /path/to/emsdk/emsdk_env.sh` first.
#
# Output is committed to src/wasm/ rather than gitignored: this app is meant
# to be cloned and run with `npm run dev` (see UNIVERSAL_FIRMWARE_PLAN.md,
# "Intended serving method: run locally"), and requiring every contributor
# or user to install Emscripten just to flash a bike would defeat the point.
# Re-run this script (and commit the result) only when vendor/stm8flash is
# updated or wasm/*.c changes.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v emcc >/dev/null 2>&1; then
	echo "emcc not found on PATH - source emsdk_env.sh first" >&2
	exit 1
fi

VENDOR=../vendor/stm8flash
OUT_DIR=../src/wasm
mkdir -p "$OUT_DIR"

# STACK_SIZE=1048576: stlinkv2.c's ONLY_WRITE_DIFFS path alloca()s a
# read-verify buffer sized to the device's flash block loop (up to 128KB for
# the largest device in stm8.c) on every flash-write call. Emscripten's 64KB
# default stack overflows on that, trapping mid-flash with "memory access out
# of bounds" - 1MB comfortably covers the largest device plus normal call
# depth.
emcc \
	-I "$VENDOR" \
	-I shim-include \
	"$VENDOR/byte_utils.c" \
	"$VENDOR/ihex.c" \
	"$VENDOR/stm8.c" \
	"$VENDOR/stlinkv2.c" \
	wasm_api.c \
	usb_bridge.c \
	-O2 \
	-sENVIRONMENT=web \
	-sASYNCIFY=1 \
	-sSTACK_SIZE=1048576 \
	-sMODULARIZE=1 \
	-sEXPORT_ES6=1 \
	-sEXPORT_NAME=createStm8flashModule \
	-sEXIT_RUNTIME=0 \
	-sALLOW_MEMORY_GROWTH=1 \
	-sEXPORTED_FUNCTIONS=_stm8flash_write_hex,_stm8flash_read_area,_stm8flash_write_area,_malloc,_free \
	-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,stringToUTF8,lengthBytesUTF8,FS \
	-o "$OUT_DIR/stm8flash.mjs"

echo "Wrote $OUT_DIR/stm8flash.mjs + stm8flash.wasm"
