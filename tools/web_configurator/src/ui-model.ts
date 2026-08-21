// UI presentation layer. Wraps the raw positional schema (schema.ts) with
// human labels and groups mutually-exclusive raw booleans into single
// select/radio controls. Every schema field ends up covered by exactly one
// control here (enforced by a check in main.ts, via app-state.ts's controls export) - no hidden/dead controls,
// unlike the Java tool's permanently-invisible startup-assist-speed-limit
// checkbox.
//
// Control-shape types and cross-section-shared helpers live in
// control-types.ts. Each page's own field metadata + named radio/intSelect
// controls live in src/sections/<id>.ts, one file per Section (see SECTIONS
// below) - this file only assembles those into the final buildControls()
// output (RAW_FIELDS iteration order + the moveBefore() reordering pass),
// so a PR that only touches one page's fields/tooltips only touches that
// page's sections/*.ts file, not this one.
//
// Tooltips are condensed from docs/EN-Parameter_configurator_guide-TSDZ2-v20.1C.6-update-6.pdf
// (the closest thing this firmware fork has to a field-by-field spec) and,
// where the PDF doesn't cover a field, from the corresponding config.h
// define's usage in src/ebike_app.c.
//
// TSDZ8 stays out of the UI entirely (motorTypeTSDZ8 is never set by any
// control here) per the plan's non-goal - if an imported .ini set it, the
// value round-trips through untouched, but this tool never offers it as a
// choice.

import { RAW_FIELDS, MIDDLE_ANGLE_ADJ, MIDDLE_OFFSET_ADJ, MIDDLE_RANGE_ADJ } from "./schema.ts";
import type { FieldValues } from "./ini-import.ts";
import type { Control, DependsOn, ExplicitFieldMeta, RadioControl, IntSelectControl } from "./control-types.ts";

export { SECTIONS, type Section } from "./control-types.ts";
export type {
  Control,
  NumberControl,
  TextControl,
  CheckboxControl,
  SignedOffsetControl,
  RadioOption,
  RadioControl,
  IntSelectControl,
} from "./control-types.ts";

import * as motor from "./sections/motor.ts";
import * as battery from "./sections/battery.ts";
import * as display from "./sections/display.ts";
import * as lights from "./sections/lights.ts";
import * as assist from "./sections/assist.ts";
import * as walkCruise from "./sections/walk-cruise.ts";
import * as ridingModes from "./sections/riding-modes.ts";
import * as throttle from "./sections/throttle.ts";
import * as temperature from "./sections/temperature.ts";
import * as startupBoost from "./sections/startup-boost.ts";
import * as advanced from "./sections/advanced.ts";
import * as misc from "./sections/misc.ts";

// Order here has no effect on final display order (every entry carries its
// own `section`, and buildControls() below only ever reads this array via
// controls.filter(c => c.section === id) or moveBefore() by key) - SECTIONS
// order just keeps this readable/consistent with the sidebar's own order.
const EXPLICIT_GROUPS: RadioControl[] = [
  ...motor.radioControls,
  ...battery.radioControls,
  ...display.radioControls,
  ...lights.radioControls,
  ...assist.radioControls,
  ...walkCruise.radioControls,
  ...ridingModes.radioControls,
  ...throttle.radioControls,
  ...temperature.radioControls,
  ...startupBoost.radioControls,
  ...advanced.radioControls,
  ...misc.radioControls,
];
const EXPLICIT_INT_SELECTS: IntSelectControl[] = [
  ...motor.intSelectControls,
  ...battery.intSelectControls,
  ...display.intSelectControls,
  ...lights.intSelectControls,
  ...assist.intSelectControls,
  ...walkCruise.intSelectControls,
  ...ridingModes.intSelectControls,
  ...throttle.intSelectControls,
  ...temperature.intSelectControls,
  ...startupBoost.intSelectControls,
  ...advanced.intSelectControls,
  ...misc.intSelectControls,
];
const EXPLICIT_FIELDS: Record<string, ExplicitFieldMeta> = {
  ...motor.fields,
  ...battery.fields,
  ...display.fields,
  ...lights.fields,
  ...assist.fields,
  ...walkCruise.fields,
  ...ridingModes.fields,
  ...throttle.fields,
  ...temperature.fields,
  ...startupBoost.fields,
  ...advanced.fields,
  ...misc.fields,
};

// Raw fields folded into the radio/select groups above - excluded from
// auto-generation so each field appears exactly once in the UI.
const GROUPED_KEYS = new Set<string>([
  ...EXPLICIT_GROUPS.flatMap((g) => g.groupKeys),
  ...EXPLICIT_INT_SELECTS.map((s) => s.key),
]);

// Fields that are genuinely dead in the Java tool (round-tripped but never
// backed by any control there either) - intentionally omitted, matching the
// plan's call to drop hidden/dead controls rather than preserve them.
// motorTypeTSDZ8 belongs here too: the file header above already says TSDZ8
// "stays out of the UI entirely" and "is never offered as a choice" - true
// of every other TSDZ8-related field, but this one had no EXPLICIT_FIELDS
// entry and so fell through to the generic auto-generated-checkbox path
// (humanized label, no tooltip - the one field in the app without one)
// instead of actually being excluded. Round-trips silently on import/export
// like the other two, same as the header always claimed it did.
//
// streetPowerLimEnabled is a different flavor of dead: it had a real,
// editable control here (unlike the three above), but src/ has no #if on
// STREET_MODE_POWER_LIMIT_ENABLED anywhere - config-h-generator.ts emits
// the macro, nothing in the firmware ever reads it. STREET_MODE_POWER_LIMIT
// applies unconditionally whenever street mode is on, checkbox or not. Its
// default was `false`, which made streetModePowerLimit's own dependsOn hide
// that always-active field from a fresh profile by default - worse than a
// merely-decorative checkbox. Dropped 2026-08-15; still round-trips through
// old .ini/.tsdz2.json files via schema.ts, same as the other three.
const DEAD_KEYS = new Set<string>([
  "streetThrottleEnabled_UNUSED",
  "throttleLegal_UNUSED",
  "motorTypeTSDZ8",
  "streetPowerLimEnabled",
]);

// Every "number" raw field is a uint8_t (0-255) in the firmware EXCEPT these
// - verified by reading src/*.c/*.h for where each config.h #define actually
// ends up (an assignment to a uint16_t/uint32_t variable or array, an EEPROM
// address split into two _0/_1 bytes, or direct use in >=16-bit arithmetic
// with no narrowing cast found anywhere). Do not add a field here just
// because its current default happens to exceed 255, or omit one just
// because its default is small - both were proven unreliable signals during
// this audit: PEDAL_TORQUE_ADC_OFFSET's default (150) is small despite being
// stored in real uint16_t variables, so a small default alone doesn't mean
// 255 is a safe cap either way.
//
// (Corrected 2026-08-12: an earlier pass here claimed POWER_ASSIST_LEVEL_4's
// default of 480 "silently truncates at compile time (480 -> 224)" and used
// that as evidence its raw value's real width didn't matter for this field -
// that arithmetic was wrong (480 -> 224 is what you'd get from casting 480
// straight to uint8_t, i.e. 480 mod 256, which is NOT what main.h's macro
// does). The real macro is `POWER_ASSIST_LEVEL_ECO (uint8_t)(POWER_ASSIST_
// LEVEL_1 / 2)` - it divides by 2 BEFORE the uint8_t cast, so 480 -> 240,
// which fits a uint8_t cleanly with no truncation at all. Power assist's
// config.h value genuinely isn't capped at 255 - see POWER_ASSIST_LEVEL_
// FIELDS below, which gives it the correct 511 cap via a separate mechanism
// from this set, since "halved before a uint8_t store" isn't the same shape
// of wide-field as the uint16_t/uint32_t fields actually listed here.)
//
// Every field not listed here is capped at 255 in the UI (see rawMax in
// buildControls) - a raw value cap based on the firmware's actual storage
// width, not a "sane range" for the setting (e.g. cell count, percentages).
const WIDE_RAW_FIELDS = new Set<string>([
  "wheelPerimeter", // WHEEL_PERIMETER - EEPROM address split into WHEEL_PERIMETER_0/_1 (main.h)
  "batteryLowVoltageCutOff", // split into BATTERY_LOW_VOLTAGE_CUT_OFF_X10_0/_1 (main.h) - x10 encoded but genuinely 2 bytes
  "targetMaxBatteryPower", // used directly as (uint32_t)TARGET_MAX_BATTERY_POWER (ebike_app.c) - no narrow storage found
  "targetMaxBatteryCapacity", // static uint16_t ui16_actual_battery_capacity = ...TARGET_MAX_BATTERY_CAPACITY... (ebike_app.c)
  "streetModePowerLimit", // same (uint32_t)STREET_MODE_POWER_LIMIT pattern as targetMaxBatteryPower
  "torqueAdcMax", // PEDAL_TORQUE_ADC_MAX only used in a preprocessor-time subtraction (main.h) - no narrowing found
  "startupBoostTorqueFactor", // static uint16_t ui16_startup_boost_factor_array[120] (ebike_app.c)
  "torqueAdcOffset", // static uint16_t ui16_adc_pedal_torque_offset(_init/_cal/_min/_max) = PEDAL_TORQUE_ADC_OFFSET (ebike_app.c)
  "coasterBrakeTorqueThreshold", // compared directly against a uint16_t torque ADC value, no narrowing cast found
  "batteryPackResistance", // static uint16_t ui16_battery_pack_resistance_x1000 = BATTERY_PACK_RESISTANCE (ebike_app.c)
  "torqueModesRefVolt", // (uint16_t)(POWER_BASED_REFERENCE_VOLTAGE * 10) (main.h)
  "actualBatteryVoltagePercent", // used directly in uint16_t arithmetic (ebike_app.c:3557), no narrowing cast found
  "actualBatteryCapacityPercent", // used directly in the same uint32_t/uint16_t expression as targetMaxBatteryCapacity
]);

// Power assist's 4 levels: still a genuine uint8_t at storage (unlike
// WIDE_RAW_FIELDS above), but the config.h value typed here is halved into
// that byte first (main.h's POWER_ASSIST_LEVEL_ECO/TOUR/SPORT/TURBO macros -
// see sections/assist.ts's POWER_ASSIST_TOOLTIP doc comment for the full
// trace), so the field itself safely holds up to 511, not 255 - 510 and 511
// both truncate down to the byte's real max of 255, while 512 wraps the
// cast to 0.
const POWER_ASSIST_LEVEL_FIELDS = new Set<string>(["powerAssist1", "powerAssist2", "powerAssist3", "powerAssist4"]);

// The 3 "delicate" torque-sensor trim fields - signed offset around a
// MIDDLE_*_ADJ constant. Kept in an advanced section, not hidden, but not
// mixed in with everyday tuning fields either (mirrors emmebrusa's stance
// on delicate parameters needing a real calibration procedure).
const SIGNED_OFFSET_FIELDS: Record<string, { label: string; middle: number; tooltip: string; dependsOn?: DependsOn }> =
  {
    torqueOffsetAdjRaw: {
      label: "Torque ADC offset trim",
      middle: MIDDLE_OFFSET_ADJ,
      tooltip:
        "Trims the torque sensor's start sensitivity. Negative = more sensitive at the start (e.g. for a hand-bike), but too low can cause an undesired start or delayed stop; positive = less sensitive. Range -20 to 235. With a negative value, also disable Assist without pedal rotation and Startup boost for safety.",
    },
    torqueRangeAdjRaw: {
      label: "Torque ADC range trim",
      middle: MIDDLE_RANGE_ADJ,
      tooltip:
        "Trims the torque sensor's amplification. Negative decreases it, positive increases it. Range -20 to 235. Applies at every level in modes that use the torque sensor. Only takes effect with Torque sensor advanced and Torque sensor calibrated both enabled.",
      dependsOn: (v) => v.torqueSensorAdvOnStart === true && v.torqueCalibration === true,
    },
    torqueAngleAdjRaw: {
      label: "Torque ADC angle trim",
      middle: MIDDLE_ANGLE_ADJ,
      tooltip:
        "Trims the initial angle of the torque-response curve. Negative = more gradual response, less consumption; positive = more reactive, higher consumption. Range -20 to 235; try 0 first, then adjust to feel. With a positive value, also disable Startup boost. Only takes effect with Torque sensor advanced and Torque sensor calibrated both enabled.",
      dependsOn: (v) => v.torqueSensorAdvOnStart === true && v.torqueCalibration === true,
    },
  };

function humanizeKey(key: string): string {
  const withSpaces = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

/** Finds a control by key - a non-radio control's own `key`, or (since RadioControl has no single `key`) a radio control whose `groupKeys` includes it. */
function indexOfControl(controls: Control[], key: string): number {
  return controls.findIndex(
    (c) => (c.kind !== "radio" && c.key === key) || (c.kind === "radio" && c.groupKeys.includes(key)),
  );
}

/** Repositions the control for `moveKey` to sit immediately before `beforeKey`, if both are present. Either key may belong to a radio group (see indexOfControl) - moving a radio itself via `moveKey` isn't exercised by any current caller, but works the same way. */
function moveBefore(controls: Control[], moveKey: string, beforeKey: string): void {
  const moveIdx = indexOfControl(controls, moveKey);
  if (moveIdx === -1) return;
  const [moved] = controls.splice(moveIdx, 1);
  const targetIdx = indexOfControl(controls, beforeKey);
  controls.splice(targetIdx === -1 ? controls.length : targetIdx, 0, moved);
}

export function buildControls(): Control[] {
  const controls: Control[] = [...EXPLICIT_GROUPS, ...EXPLICIT_INT_SELECTS];

  for (const f of RAW_FIELDS) {
    if (GROUPED_KEYS.has(f.key) || DEAD_KEYS.has(f.key)) continue;

    if (f.key in SIGNED_OFFSET_FIELDS) {
      const meta = SIGNED_OFFSET_FIELDS[f.key];
      controls.push({
        kind: "signedOffset",
        key: f.key,
        label: meta.label,
        section: "advanced",
        middle: meta.middle,
        tooltip: meta.tooltip,
        dependsOn: meta.dependsOn,
      });
      continue;
    }

    const meta = EXPLICIT_FIELDS[f.key];
    const label = meta?.label ?? humanizeKey(f.key);
    const section = meta?.section ?? "misc";

    if (f.type === "bool") {
      controls.push({
        kind: "checkbox",
        key: f.key,
        label,
        section,
        tooltip: meta?.tooltip,
        dependsOn: meta?.dependsOn,
        required: meta?.required,
        hint: meta?.hint,
        noteBefore: meta?.noteBefore,
      });
    } else if (f.type === "string" || meta?.kind === "text") {
      controls.push({
        kind: "text",
        key: f.key,
        label,
        section,
        tooltip: meta?.tooltip,
        dependsOn: meta?.dependsOn,
        required: meta?.required,
        noteBefore: meta?.noteBefore,
      });
    } else {
      controls.push({
        kind: "number",
        key: f.key,
        label,
        section,
        tooltip: meta?.tooltip,
        dependsOn: meta?.dependsOn,
        required: meta?.required,
        hint: meta?.hint,
        safetyWarning: meta?.safetyWarning,
        noteBefore: meta?.noteBefore,
        speedField: meta?.speedField,
        distanceField: meta?.distanceField,
        rawMax: WIDE_RAW_FIELDS.has(f.key) ? 65535 : POWER_ASSIST_LEVEL_FIELDS.has(f.key) ? 511 : 255,
        sliderRange: meta?.sliderRange,
        dangerAbove: meta?.dangerAbove,
        recommendedValue: meta?.recommendedValue,
        presetValues: meta?.presetValues,
      });
    }
  }

  // Every EXPLICIT_INT_SELECTS control otherwise floats to the very front of
  // its section (see the top of buildControls) - move "Battery cell count"
  // back to its natural raw-order spot instead of leading the whole Battery
  // section. Its raw-order neighbor was "Motor deceleration" (see schema.ts),
  // but that's now on the separate Motor page, so target the next field
  // that's still actually in Battery ("Battery low-voltage cutoff").
  moveBefore(controls, "batteryCellsNumber", "batteryLowVoltageCutOff");

  // "Assist level 5 mode" and "Assist level 5 percent" are logically one
  // pair (the mode choice determines how the percent field is interpreted)
  // but sit far apart in the raw positional order - group them visually.
  moveBefore(controls, "assistLevel5Mode", "assistLevel5Percent");

  // "Auto-display data count" only matters when auto-cycling is on (see its
  // dependsOn above) - move it right after the checkbox that gates it,
  // ahead of the per-slot delay fields, instead of its far-away raw order.
  moveBefore(controls, "autoDataNumberDisplay", "delayDisplayData1");

  // "Cruise control enabled" gates every other cruise field (see their
  // dependsOn above) but sits after all of them in raw order - move it
  // to the front of the group instead.
  moveBefore(controls, "cruiseEnabled", "cruiseSpeed1");

  // The four walk-assist overrides are new tail-group-8/9 fields (raw order
  // puts them at the very end of the section) - move them to sit directly
  // after cruiseSpeed4, so groupSectionControls' cruiseSpeed-group detection
  // (render/control-group.ts) finds them immediately following the 4-cell
  // family it just built and can fold them into the same card as extra
  // rows. Order here is the final display order (ECO/TOUR/SPORT/TURBO) -
  // Sport/Turbo go first (each moveBefore inserts right before its target,
  // so the last call ends up closest to it), then Eco/Tour are threaded in
  // ahead of Sport.
  moveBefore(controls, "cruiseOverrideSport", "cruiseWithoutPedaling");
  moveBefore(controls, "cruiseOverrideTurbo", "cruiseWithoutPedaling");
  moveBefore(controls, "cruiseOverrideEco", "cruiseOverrideSport");
  moveBefore(controls, "cruiseOverrideTour", "cruiseOverrideSport");

  // "Startup boost enabled at power-on" (the on/off toggle) reads better
  // before "Startup boost at zero" (which mode triggers it) - the enable
  // switch logically comes first. Every radio in EXPLICIT_GROUPS otherwise
  // floats to the very front of its section (Startup boost at zero is the
  // only EXPLICIT_GROUPS radio in "startup-boost"), so without this the
  // toggle would sit after the sub-setting that only matters once it's on.
  moveBefore(controls, "startupBoostOnStart", "boostAtZeroCadence");

  // The lights-configuration intSelects (EXPLICIT_INT_SELECTS) get unshifted
  // to the very front of `controls` like every other explicit group - which
  // would put them ahead of "Lights enabled" itself (a plain raw checkbox,
  // not floated) despite each one depending on it. Move them back to their
  // natural raw-order position (right after "Lights enabled") instead. Now
  // that Lights is its own section, the beforeKey target ("maxSpeedFromDisplay",
  // a Display-section field) is just a stable array-position anchor - it
  // doesn't matter that it's a different section, since only relative order
  // within "lights" affects that page's rendering.
  for (const key of [
    "lightsConfigurationOnStartup",
    "lightsConfiguration1",
    "lightsConfiguration2",
    "lightsConfiguration3",
  ]) {
    moveBefore(controls, key, "maxSpeedFromDisplay");
  }
  // "Display data 1-6" picks *what* to show; "Auto-cycle display data" and
  // the fields after it control *how* that cycles - show the data-slot
  // picker first instead of its far-away raw order at the very end.
  for (let n = 1; n <= 6; n++) moveBefore(controls, `displayData${n}`, "autoDisplayData");

  // "Battery pack resistance" is a state-of-charge display setting closely
  // related to the cutoff/calibration fields above it, but sits much later
  // in raw order (after all the assist/advanced fields) - move it right
  // after "Battery low-voltage cutoff" instead.
  moveBefore(controls, "batteryPackResistance", "actualBatteryVoltagePercent");

  // Riding modes: both Offroad-mode fields above every Street-mode field,
  // instead of interleaved by counterpart. Built as a chain working backward
  // from the fixed anchor (streetWalkEnabled, which never moves) so each
  // move's target is resolved fresh and the final order is exactly:
  // Offroad power limit, Offroad speed limit, Street power limit enabled,
  // Street power limit, Street speed limit, Street cruise enabled,
  // Street walk assist enabled.
  moveBefore(controls, "streetCruiseEnabled", "streetWalkEnabled");
  moveBefore(controls, "streetModeSpeedLimit", "streetCruiseEnabled");
  moveBefore(controls, "streetModePowerLimit", "streetModeSpeedLimit");
  moveBefore(controls, "wheelMaxSpeed", "streetModePowerLimit");
  moveBefore(controls, "targetMaxBatteryPower", "wheelMaxSpeed");

  // "Wheel circumference" moved from Motor & battery into Display (it only
  // feeds the display's speed/odometer math, nothing motor/battery-related)
  // - put it right under "Speed units" (the other speed-unit-defining
  // field), ahead of the rest of the section, with "Max speed read from
  // display" (also directly about the speed the display computes) right
  // after it.
  moveBefore(controls, "wheelPerimeter", "lightsEnabled");
  moveBefore(controls, "maxSpeedFromDisplay", "lightsEnabled");
  // "Display settings menu enabled" moved from Power-on defaults into
  // Display (see sections/display.ts's own comment on this field) - put it
  // directly after "Max speed read from display", both about what the
  // display itself can do independent of this web configurator.
  moveBefore(controls, "setParamOnStart", "lightsEnabled");

  // "Optional brake input" and its sub-setting share "Throttle & brake" with
  // the throttle fields now. Every EXPLICIT_GROUPS radio otherwise floats to
  // the very front of its section, which would put it ahead of Optional
  // throttle input - move both to the end instead, after every throttle
  // field, so the page reads as "throttle stuff, then brake stuff" (matching
  // the section title's word order) rather than interleaved.
  moveBefore(controls, "brakeSensor", "streetWalkEnabled");
  moveBefore(controls, "coasterBrakeTorqueThreshold", "streetWalkEnabled");

  // "Startup assist enabled" shares "Startup boost & smooth start" with the
  // other pedal-start-from-a-stop fields (it's a manually-triggered sibling
  // of Startup boost, not a Walk assist variant - see its tooltip) but sits
  // far away in raw order. Put it after the automatic mechanisms above it.
  moveBefore(controls, "startupAssistEnabled", "batteryCurrentMax");

  // "Smooth start enabled/ramp" share the section with Startup boost, but
  // are an unrelated, opposite-direction behavior (boost adds power at
  // start, smooth start attenuates it) - put them last on the page, after
  // every Startup boost/assist field, using the same anchor as the move
  // above so they land right after it.
  moveBefore(controls, "smoothStartEnabled", "batteryCurrentMax");
  moveBefore(controls, "smoothStartRamp", "batteryCurrentMax");

  // "Field weakening enabled" and "Overcurrent delay" moved from Advanced
  // torque calibration into Motor - neither is a torque-calibration
  // setting (see their own tooltips: PWM/cadence behavior, and an
  // overcurrent protection timer). Put Field weakening right after its
  // paired setting PWM frequency (its own tooltip already references it),
  // and Overcurrent delay with the other Motor-blocked-* protection fields,
  // instead of trailing at the end of Motor's raw order.
  moveBefore(controls, "fieldWeakeningEnabled", "motorAcceleration");
  moveBefore(controls, "overcurrentDelay", "motorDeceleration");

  // Motor deceleration next to Motor acceleration (its direct counterpart -
  // both are 0-100 ramp-rate sliders feeding the same map_ui8() shape in
  // set_motor_ramp()/ebike_app_init(), just up vs down) instead of separated
  // by the unrelated Motor-blocked-* watchdog thresholds in raw field order.
  moveBefore(controls, "motorDeceleration", "motorBlockedCounterThreshold");

  // "eMTB assist based on" only shapes the eMTB assist curve (see
  // src/ebike_app.c's apply_emtb_assist - ui8_eMTB_based_on_power only
  // touches that function's own denominator calc), unlike "Torque modes
  // based on" which is shared across Torque/eMTB/Hybrid and stays up top.
  // Put it with the assist level fields it actually affects.
  moveBefore(controls, "eMtbPower", "emtbAssist1");

  // "Torque-based-on-power reference voltage" moved from Advanced torque
  // calibration into Assist levels - it's meaningless without "Torque modes
  // based on" (also here), which gates whether it does anything at all, and
  // it was easy to miss (and leave stale after picking a different voltage
  // class) tucked away on an unrelated page. Put it directly after the
  // toggle that controls its relevance.
  moveBefore(controls, "torqueModesRefVolt", "assistWithoutPedalRotation");

  return controls;
}

/** All raw field keys any control in `controls` can read or write - used by main.ts to assert full coverage. */
export function coveredKeys(controls: Control[]): Set<string> {
  const keys = new Set<string>();
  for (const c of controls) {
    if (c.kind === "radio") {
      for (const k of c.groupKeys) keys.add(k);
    } else {
      keys.add(c.key);
    }
  }
  return keys;
}

export function selectedRadioOption(control: RadioControl, values: FieldValues): number {
  for (let i = 0; i < control.options.length; i++) {
    const opt = control.options[i];
    if (Object.entries(opt.values).every(([k, v]) => values[k] === v)) return i;
  }
  return 0;
}
