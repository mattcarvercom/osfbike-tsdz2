// The .ini importer is purely positional (see ini-import.ts's own header
// comment): a real .ini file carries no field names at all, just one value
// per line, read top to bottom. RAW_FIELDS in schema.ts is what gives that
// sequence meaning - its declared order *is* the file format. Nothing at
// the type level stops a future edit from reordering, inserting, or
// removing an entry there; if that ever happens, every field from that
// point on would silently start reading a different line than before -
// still a "successful" import (same field count, no thrown error), just
// with every downstream value in the wrong field. schema.ts's own comment
// already says "do not reorder" - these tests are what actually enforces
// it, plus (in the second test) an independent check that ini-import.ts's
// cursor/tail-group logic hasn't drifted from what RAW_FIELDS says the
// positions should be.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importIni } from "../ini-import.ts";
import { RAW_FIELDS, type RawField } from "../schema.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

function shapeOf(f: RawField): string {
  return `${f.key}:${f.type}${f.tailGroup !== undefined ? `:tail${f.tailGroup}` : ""}${f.optional ? ":optional" : ""}`;
}

// Captured from the current (verified-correct - see ini-import.test.ts's
// existing fixture/config.h coverage) RAW_FIELDS. Any diff here means
// schema.ts's field order, a key, a type, or a tailGroup/optional flag
// changed - which is exactly "this .ini file now imports into different
// fields than before" and needs a deliberate look, not a silent pass.
const EXPECTED_SHAPE = [
  "motorTypeTSDZ2_36V:bool",
  "motorTypeTSDZ2_48V:bool",
  "torqueCalibration:bool",
  "motorAcceleration:int",
  "assistWithoutPedalRotation:bool",
  "assistWithoutPedalRotationThreshold:int",
  "torqueAdcStep:int",
  "torqueAdcMax:int",
  "startupBoostTorqueFactor:int",
  "motorBlockedCounterThreshold:int",
  "motorBlockedBatteryCurrentThresholdX10:int",
  "motorBlockedErpsThreshold:int",
  "startupBoostCadenceStep:int",
  "batteryCurrentMax:int",
  "targetMaxBatteryPower:int",
  "targetMaxBatteryCapacity:int",
  "batteryCellsNumber:int",
  "motorDeceleration:int",
  "batteryLowVoltageCutOff:int",
  "actualBatteryVoltagePercent:int",
  "actualBatteryCapacityPercent:int",
  "liIonCellOvervolt:string",
  "liIonCellResetSocPercent:string",
  "liIonCellVoltsFull:string",
  "liIonCellVolts3Of4:string",
  "liIonCellVolts2Of4:string",
  "liIonCellVolts1Of4:string",
  "liIonCellVolts5Of6:string",
  "liIonCellVolts4Of6:string",
  "liIonCellVolts3Of6:string",
  "liIonCellVolts2Of6:string",
  "liIonCellVolts1Of6:string",
  "liIonCellVoltsEmpty:string",
  "wheelPerimeter:int",
  "wheelMaxSpeed:int",
  "lightsEnabled:bool",
  "walkAssistEnabled:bool",
  "brakeSensor:bool",
  "optionalAdcDisabled:bool",
  "optionalAdcThrottle:bool",
  "optionalAdcTemperature:bool",
  "streetModeOnStart:bool",
  "setParamOnStart:bool",
  "odoCompensation:bool",
  "startupBoostOnStart:bool",
  "torqueSensorAdvOnStart:bool",
  "lightsConfigurationOnStartup:int",
  "assistStartupPower:bool",
  "assistStartupTorque:bool",
  "assistStartupCadence:bool",
  "assistStartupEmtb:bool",
  "lightsConfiguration1:int",
  "lightsConfiguration2:int",
  "lightsConfiguration3:int",
  "streetPowerLimEnabled:bool",
  "streetModePowerLimit:int",
  "streetModeSpeedLimit:int",
  "streetThrottleEnabled_UNUSED:bool",
  "streetCruiseEnabled:bool",
  "adcThrottleMin:int",
  "adcThrottleMax:int",
  "motorTempMin:int",
  "motorTempMax:int",
  "tempErrorMinLimitEnabled:bool",
  "displayTypeVLCD6:bool",
  "displayTypeVLCD5:bool",
  "displayTypeXH18:bool",
  "displayWorkingFlag:bool",
  "displayAlwaysOn:bool",
  "maxSpeedFromDisplay:bool",
  "delayMenuOn:int",
  "coasterBrakeEnabled:bool",
  "coasterBrakeTorqueThreshold:int",
  "autoDisplayData:bool",
  "startupAssistEnabled:bool",
  "delayDisplayData1:int",
  "delayDisplayData2:int",
  "delayDisplayData3:int",
  "delayDisplayData4:int",
  "delayDisplayData5:int",
  "delayDisplayData6:int",
  "displayData1:int",
  "displayData2:int",
  "displayData3:int",
  "displayData4:int",
  "displayData5:int",
  "displayData6:int",
  "powerAssist1:int",
  "powerAssist2:int",
  "powerAssist3:int",
  "powerAssist4:int",
  "torqueAssist1:int",
  "torqueAssist2:int",
  "torqueAssist3:int",
  "torqueAssist4:int",
  "cadenceAssist1:int",
  "cadenceAssist2:int",
  "cadenceAssist3:int",
  "cadenceAssist4:int",
  "emtbAssist1:int",
  "emtbAssist2:int",
  "emtbAssist3:int",
  "emtbAssist4:int",
  "walkSpeed1:int",
  "walkSpeed2:int",
  "walkSpeed3:int",
  "walkSpeed4:int",
  "walkSpeedLimit:int",
  "walkTimeEnabled:bool",
  "walkAssistTime:int",
  "cruiseSpeed1:int",
  "cruiseSpeed2:int",
  "cruiseSpeed3:int",
  "cruiseSpeed4:int",
  "cruiseWithoutPedaling:bool",
  "cruiseThresholdSpeed:int",
  "torqueAdcOffset:int",
  "autoDataNumberDisplay:int",
  "unitsKilometers:bool",
  "unitsMiles:bool",
  "assistThrottleMin:int",
  "assistThrottleMax:int",
  "streetWalkEnabled:bool",
  "assistStartupHybrid:bool",
  "startupNone:bool",
  "startupSoc:bool",
  "startupVolts:bool",
  "fieldWeakeningEnabled:bool",
  "torqueOffsetAdjRaw:int:optional",
  "torqueRangeAdjRaw:int:optional",
  "torqueAngleAdjRaw:int:optional",
  "torqueAdcStepAdv:int",
  "socAuto:bool",
  "socWh:bool",
  "socVolts:bool",
  "adcStepEstimated:bool",
  "boostAtZeroCadence:bool",
  "boostAtZeroSpeed:bool",
  "displayType850C:bool",
  "throttleLegal_UNUSED:bool",
  "temperatureSwitch:bool:tail1",
  "eMtbPower:bool:tail1",
  "eMtbTorque:bool:tail1",
  "smoothStartEnabled:bool:tail1",
  "smoothStartRamp:int:tail1",
  "temperatureSensorType:bool:tail1",
  "cruiseEnabled:bool:tail1",
  "throttleMode:int:tail1",
  "throttleModeOnStreetMode:int:tail1",
  "assistLevel5Percent:int:tail1",
  "alternativeMiles:bool:tail1",
  "pwm18kHz:bool:tail2",
  "pwm19kHz:bool:tail2",
  "overcurrentDelay:int:tail2",
  "motorTypeTSDZ8:bool:tail3",
  "displayTypeEKD01:bool:tail4",
  "assistLevel5Mode:int:tail4",
  "boostAtZeroAuto:bool:tail5",
  "batteryPackResistance:int:tail6",
  "torqueModesBasedOnPower:bool:tail7",
  "torqueModesRefVolt:int:tail7",
  "cruiseOverrideSport:bool:tail8",
  "cruiseOverrideTurbo:bool:tail8",
  "cruiseOverrideEco:bool:tail9",
  "cruiseOverrideTour:bool:tail9",
  "displayTypeDZ40:bool:tail10",
  "batterySagIndicatorEnabled:bool:tail11",
  "batteryVoltageSagFilterShift:int:tail11",
  "displayType860C:bool:tail12",
];

test("RAW_FIELDS positional order/shape is locked - the .ini format has no field names, so this order IS the format", () => {
  const actual = RAW_FIELDS.map(shapeOf);
  assert.deepEqual(
    actual,
    EXPECTED_SHAPE,
    "RAW_FIELDS changed shape (key, type, tailGroup, or optional flag, at some position). " +
      "If this is a deliberate schema change, update EXPECTED_SHAPE here to match - but first " +
      "confirm every downstream field is still reading the .ini line it's supposed to.",
  );
});

test("RAW_FIELDS has no duplicate keys (a duplicate would mean two fields silently share one imported value)", () => {
  const keys = RAW_FIELDS.map((f) => f.key);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const k of keys) {
    if (seen.has(k)) dupes.push(k);
    seen.add(k);
  }
  assert.deepEqual(dupes, []);
});

test("full positional decode of a real, fully-populated fixture matches importIni() field-for-field, verified independently of ini-import.ts's own cursor logic", () => {
  // Default_Settings_TSDZ2_48V.ini has every optional/tailGroup line present
  // (161 lines for 161 RAW_FIELDS, zero import warnings - verified below),
  // so for this one fixture "field N reads line N" holds with no branching,
  // letting this test decode it with a tiny standalone parser instead of
  // reusing importIni()'s own line-consumption code - a real independent
  // check, not a tautology.
  const path = join(REPO_ROOT, "settings", "proven", "Default_Settings_TSDZ2_48V.ini");
  const text = readFileSync(path, "utf-8");
  const lines = text.split(/\r\n|\r|\n/);
  assert.equal(
    lines.length,
    RAW_FIELDS.length,
    "fixture line count must match RAW_FIELDS.length for this test's 1-line-per-field assumption to hold",
  );

  const expected: Record<string, boolean | number | string> = {};
  RAW_FIELDS.forEach((f, i) => {
    const raw = lines[i];
    expected[f.key] =
      f.type === "bool" ? raw.trim().toLowerCase() === "true" : f.type === "int" ? parseInt(raw.trim(), 10) : raw;
  });

  const { values, warnings } = importIni(text);
  assert.deepEqual(warnings, [], "expected this fully-populated fixture to need no tail-group/optional fallbacks");

  // unitsKilometers/unitsMiles/alternativeMiles go through an extra
  // priority-resolution step in importIni() (mph > alt.mph > km/h) that a
  // plain positional decode doesn't know about - excluded here and checked
  // on their own terms below instead of baking that resolution logic into
  // this test's independent decoder.
  const RESOLVED_SEPARATELY = new Set(["unitsKilometers"]);
  for (const f of RAW_FIELDS) {
    if (RESOLVED_SEPARATELY.has(f.key)) continue;
    assert.equal(
      values[f.key],
      expected[f.key],
      `field "${f.key}" (position ${RAW_FIELDS.indexOf(f) + 1}) mismatched a plain positional decode`,
    );
  }
  // This fixture's raw unitsMiles/alternativeMiles are both false, so the
  // priority resolution has nothing to override - unitsKilometers should
  // still equal its raw line value.
  assert.equal(values.unitsMiles, false);
  assert.equal(values.alternativeMiles, false);
  assert.equal(values.unitsKilometers, expected.unitsKilometers);
});
