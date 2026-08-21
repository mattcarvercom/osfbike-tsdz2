import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUndefinedGlobals, nextHelperFiles } from "../sdcc-link-discovery.ts";

test("parseUndefinedGlobals: extracts symbol names from sdld warning lines", () => {
  const log = [
    "some other line",
    "?ASlink-Warning-Undefined Global '___sdcc_external_startup' referenced by module 'main'",
    "?ASlink-Warning-Undefined Global '__mulschar' referenced by module 'ebike_app'",
  ];
  assert.deepEqual(parseUndefinedGlobals(log), ["___sdcc_external_startup", "__mulschar"]);
});

test("parseUndefinedGlobals: empty log or no matching lines yields no symbols", () => {
  assert.deepEqual(parseUndefinedGlobals([]), []);
  assert.deepEqual(parseUndefinedGlobals(["Linking...", "no warnings here"]), []);
});

test("nextHelperFiles: maps missing symbols to their source files, deduping one file resolving multiple symbols", () => {
  // Regression case for the _mulschar.c bug (tools/CLAUDE.md 2026-08-12): one
  // file provides 3 related symbols - all 3 missing at once must still only
  // pull the file in once.
  const helperSymbols = {
    __mulschar: "lib-c/_mulschar.c",
    __muluschar: "lib-c/_mulschar.c",
    __mulsuchar: "lib-c/_mulschar.c",
    __divsint: "lib-asm/_divsint.s",
  };
  const files = nextHelperFiles(["__mulschar", "__muluschar", "__mulsuchar"], helperSymbols, new Set());
  assert.deepEqual(files, ["lib-c/_mulschar.c"]);
});

test("nextHelperFiles: excludes files already included on an earlier iteration", () => {
  const helperSymbols = { __divsint: "lib-asm/_divsint.s", __divulong: "lib-c/_divulong.c" };
  const files = nextHelperFiles(["__divsint", "__divulong"], helperSymbols, new Set(["lib-asm/_divsint.s"]));
  assert.deepEqual(files, ["lib-c/_divulong.c"]);
});

test("nextHelperFiles: an unmapped symbol (no HELPER_SYMBOLS entry) is silently ignored, not crashed on", () => {
  const files = nextHelperFiles(["__totally_unknown_symbol"], { __divsint: "lib-asm/_divsint.s" }, new Set());
  assert.deepEqual(files, []);
});

test("nextHelperFiles: no missing symbols yields no new files", () => {
  assert.deepEqual(nextHelperFiles([], { __divsint: "lib-asm/_divsint.s" }, new Set()), []);
});
