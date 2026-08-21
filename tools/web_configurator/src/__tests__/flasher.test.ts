import { test } from "node:test";
import assert from "node:assert/strict";
import { requireWasmBytes } from "../flasher.ts";

test("requireWasmBytes: passes through a valid non-negative finite byte count", () => {
  assert.equal(requireWasmBytes(0, "Flashing"), 0);
  assert.equal(requireWasmBytes(23241, "Flashing"), 23241);
});

test("requireWasmBytes: throws on a negative result", () => {
  assert.throws(() => requireWasmBytes(-1, "Flashing"), /Flashing failed/);
});

test("requireWasmBytes: throws on NaN/undefined - the documented mid-call C exit() case where a ccall promise resolves instead of rejecting", () => {
  assert.throws(() => requireWasmBytes(NaN, "Reading flash"), /Reading flash failed/);
  // A real ccall() would never literally type-check as `number` here, but at
  // runtime Emscripten's Asyncify + -sEXIT_RUNTIME=0 combo can resolve with
  // `undefined` - Number.isFinite(undefined) is false, same code path as NaN.
  assert.throws(() => requireWasmBytes(undefined as unknown as number, "Restoring eeprom"), /Restoring eeprom failed/);
});

test("requireWasmBytes: error message includes the reseat-the-cable hint every failure branch shares", () => {
  assert.throws(() => requireWasmBytes(-1, "Flashing"), /reseat the ST-Link's USB cable/);
});
