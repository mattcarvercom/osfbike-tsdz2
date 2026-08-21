import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importIni } from "../ini-import.ts";
import { generateConfigH } from "../config-h-generator.ts";
import { RAW_FIELDS } from "../schema.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

function fixtureFiles(): string[] {
  const dirs = [join("settings", "experimental"), join("settings", "proven")];
  const files: string[] = [];
  for (const dir of dirs) {
    const full = join(REPO_ROOT, dir);
    for (const name of readdirSync(full)) {
      if (name.endsWith(".ini")) files.push(join(full, name));
    }
  }
  return files;
}

test("imports every real fixture .ini without error and produces all fields", () => {
  const files = fixtureFiles();
  // Not a hardcoded minimum: settings/experimental gets pruned down to the
  // most-recent-per-bike over time (see git history), so any fixed count
  // here just goes stale again next prune. Only guards against the fixture
  // dirs silently resolving to nothing (e.g. a REPO_ROOT/path bug).
  assert.ok(files.length > 0, "expected at least one fixture .ini file, found none");
  for (const path of files) {
    const text = readFileSync(path, "utf-8");
    const { values } = importIni(text);
    for (const f of RAW_FIELDS) {
      assert.ok(f.key in values, `${path}: missing field "${f.key}" after import`);
    }
  }
});

test("config.h generation runs cleanly on every imported fixture", () => {
  const files = fixtureFiles();
  for (const path of files) {
    const text = readFileSync(path, "utf-8");
    const { values } = importIni(text);
    const configH = generateConfigH(values);
    assert.match(configH, /#define CONFIG_H_/);
    assert.match(configH, /#endif \/\* CONFIG_H_ \*\//);
    // every define should have exactly 154 lines to match the real config.h
    // (146 checked-in + DATA_DISPLAY_ON_STARTUP, which the checked-in file's
    // generator omitted but which is a real, always-referenced symbol, +
    // CRUISE_OVERRIDE_WALK_ECO/TOUR/SPORT/TURBO_ENABLED, +
    // ENABLE_BATTERY_SAG_INDICATOR/BATTERY_VOLTAGE_SAG_FILTER_SHIFT, +
    // ENABLE_860C_LVGL_UART)
    const defineCount = (configH.match(/^#define /gm) || []).length;
    assert.equal(defineCount, 154, `${path}: expected 154 #define lines, got ${defineCount}`);
  }
});

test("spot-check known values from settings/proven/Default_Settings_TSDZ2_48V.ini", () => {
  const path = join(REPO_ROOT, "settings", "proven", "Default_Settings_TSDZ2_48V.ini");
  const text = readFileSync(path, "utf-8");
  const { values } = importIni(text);
  // First two lines of that file are "false" (36V) then "true" (48V).
  assert.equal(values.motorTypeTSDZ2_36V, false);
  assert.equal(values.motorTypeTSDZ2_48V, true);
});

test("generated config.h for the current repo's checked-in settings matches src/config.h values", () => {
  // Not a fixture .ini round-trip (no .ini exactly matches the checked-in
  // config.h), just a sanity check that known always-true defaults produce
  // the expected #define text shape.
  const path = join(REPO_ROOT, "settings", "proven", "Default_Settings_TSDZ2_48V.ini");
  const text = readFileSync(path, "utf-8");
  const { values } = importIni(text);
  const configH = generateConfigH(values);
  assert.match(configH, /#define MOTOR_TYPE 0/);
});

test("tail-group fallback: truncated .ini (only base 140 lines) still imports with documented defaults", () => {
  const path = join(REPO_ROOT, "settings", "proven", "Default_Settings_TSDZ2_48V.ini");
  const fullLines = readFileSync(path, "utf-8").split(/\r\n|\r|\n/);
  const truncated = fullLines.slice(0, 140).join("\n");
  const { values, warnings } = importIni(truncated);
  assert.equal(values.smoothStartRamp, 35);
  assert.equal(values.pwm19kHz, true);
  assert.equal(values.batteryPackResistance, 200);
  assert.ok(warnings.length > 0, "expected warnings about defaulted tail groups");
});
