#!/usr/bin/env bash
# Fetches Nordic's official nRF5 SDK v12.3.0 and places it where SW102/Makefile's
# SDK_ROOT expects it (SW102/nRF5_SDK_12.3.0/, next to this script). Not committed to
# git - it's a ~70MB zip / ~270MB unpacked third-party vendor tree, unrelated to this
# project's own source changes, so it's gitignored and fetched on demand instead.
#
# Usage: firmwares/display/SW102/setup-sdk.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$SCRIPT_DIR/SW102/nRF5_SDK_12.3.0"
SDK_URL="http://developer.nordicsemi.com/nRF5_SDK/nRF5_SDK_v12.x.x/nRF5_SDK_12.3.0_d7731ad.zip"

if [ -d "$SDK_DIR" ]; then
  echo "Already present at $SDK_DIR - remove it first to re-fetch."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading nRF5 SDK 12.3.0 from Nordic ($SDK_URL)..."
curl -L --fail -o "$TMP/sdk.zip" "$SDK_URL"

echo "Extracting..."
unzip -q "$TMP/sdk.zip" -d "$TMP/extracted"

# The zip's top-level folder is named with a trailing commit hash
# (nRF5_SDK_12.3.0_d7731ad) - rename to the plain version SDK_ROOT expects.
mv "$TMP/extracted/nRF5_SDK_12.3.0_d7731ad" "$SDK_DIR"

# Nordic ships this SDK's source/build files CRLF-terminated; the patch
# below was diffed against LF-normalized content, so normalize first or
# every hunk fails on line-ending mismatch alone.
find "$SDK_DIR" \( -name '*.c' -o -name '*.h' -o -name '*.S' -o -name '*.ld' -o -name 'Makefile*' \) -print0 \
  | xargs -0 sed -i 's/\r$//'

# A handful of files in this SDK carry real local patches (found by diffing
# the previously-committed vendored copy against a pristine download - not
# just a size-prune, actual fixes): app_uart_get()'s declaration changed to
# match this project's own app_uart_fifo_mod.c, quoting fixes in
# Makefile.common/posix so GNU_INSTALL_ROOT resolves correctly on Linux, and
# a stack-canary-fill addition in the startup file for overflow debugging.
# Re-applied here since the pristine zip doesn't carry them.
echo "Applying local patches..."
patch -p1 -d "$SDK_DIR" < "$SCRIPT_DIR/nrf5-sdk-12.3.0.patch"

echo "SDK ready at $SDK_DIR"
