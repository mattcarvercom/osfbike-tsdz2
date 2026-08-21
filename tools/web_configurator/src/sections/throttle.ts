// Throttle & brake section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { radio, type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
import type { FieldValues } from "../ini-import.ts";

/** Both "Optional throttle/brake input" radios can independently be set to their respective temperature option - flagged reciprocally below, not blocked outright, since it still builds/flashes fine; it just means neither a throttle nor a brake sensor/coaster brake is actually wired up. */
function bothTemperatureInputsSelected(v: FieldValues): boolean {
  return v.optionalAdcTemperature === true && v.temperatureSwitch === true;
}

// programmer_type_t-style int enum shared by "Throttle mode" and "Throttle
// mode (street mode)" - see src/main.h's DISABLED/PEDALING/W_O_P_6KM_H_ONLY/
// W_O_P_6KM_H_AND_PEDALING/UNCONDITIONAL. Both int-selects previously only
// offered 3 of these 5 values; an imported .ini with throttleMode 2 or 3
// would silently show the wrong selection in the dropdown even though the
// underlying value round-tripped correctly.
const THROTTLE_MODE_OPTIONS = [
  { label: "Disabled", value: 0 },
  { label: "Pedaling required", value: 1 },
  { label: "6 km/h only", value: 2 },
  { label: "6 km/h & pedaling", value: 3 },
  { label: "Unconditional", value: 4 },
];

export const BRAKE_FEATURE: RadioControl = {
  ...radio(
    "Optional brake input",
    "throttle",
    ["brakeSensor", "coasterBrakeEnabled", "temperatureSwitch"],
    [
      { label: "Disabled", values: { brakeSensor: false, coasterBrakeEnabled: false, temperatureSwitch: false } },
      { label: "Brake sensor", values: { brakeSensor: true, coasterBrakeEnabled: false, temperatureSwitch: false } },
      {
        label: "Coaster brake",
        values: { brakeSensor: false, coasterBrakeEnabled: true, temperatureSwitch: false },
      },
      {
        label: "Temperature sensor",
        values: { brakeSensor: false, coasterBrakeEnabled: false, temperatureSwitch: true },
      },
    ],
    "What's wired to the optional brake input. This choice is NOT a safety switch - the firmware's actual brake cutoff (ramping the motor's power to 0 whenever the brake pin reads active) runs unconditionally in the motor-control loop no matter what's selected here, including Disabled. All this setting really does is decide which extra software features get unlocked. Brake sensor: assumes a standard cut-off switch, and additionally unlocks walk-assist debounce, cruise-without-pedaling, and street-mode cruise (Walk assist & cruise control / Riding modes pages). Coaster brake: motor works as a coaster-brake motor instead, detecting backward pedaling via the torque sensor - disables throttle, walk assist, and cruise-without-pedaling for safety, and doesn't replace the physical brake-pin reading, it's on top of it. Temperature sensor: an on/off thermostat (NO, max 85C) wired in place of a brake sensor - trips ERROR_OVERTEMPERATURE (E06) instead, distinct from the graduated Optional throttle input sensor above (no min/max calibration, just a fixed trip point). Disabled is truly optional, not a precaution - picking it only withholds those three extra features, it doesn't protect against anything. Selecting Brake sensor even with no brake switch actually wired up won't cause problems for two of those three (cruise-without-pedaling and street-mode cruise are driven by the display's walk-assist button, never the brake pin) - walk-assist debounce is the one exception, since it does read the brake pin live, and an unconnected pin floats to an undefined electrical state rather than a guaranteed 'not pressed'.",
  ),
  toggleGroup: true,
  hint: (v) =>
    bothTemperatureInputsSelected(v)
      ? "Optional throttle input (above) is also set to Temperature sensor - that leaves you with no throttle and no brake sensor/coaster brake installed. Usually only one input should be repurposed for temperature."
      : null,
};

export const OPTIONAL_ADC: RadioControl = {
  ...radio(
    "Optional throttle input",
    "throttle",
    ["optionalAdcDisabled", "optionalAdcThrottle", "optionalAdcTemperature"],
    [
      {
        label: "Disabled",
        values: { optionalAdcDisabled: true, optionalAdcThrottle: false, optionalAdcTemperature: false },
      },
      {
        label: "Throttle",
        values: { optionalAdcDisabled: false, optionalAdcThrottle: true, optionalAdcTemperature: false },
      },
      {
        label: "Temperature sensor",
        values: { optionalAdcDisabled: false, optionalAdcThrottle: false, optionalAdcTemperature: true },
      },
    ],
    "What's wired to the optional throttle input - throttle and temperature sensor are alternatives, only one can be installed at a time. Throttle is recommended only with brake sensors installed and enabled.",
  ),
  hint: (v) =>
    bothTemperatureInputsSelected(v)
      ? "Optional brake input (below) is also set to Temperature sensor - that leaves you with no throttle and no brake sensor/coaster brake installed. Usually only one input should be repurposed for temperature."
      : null,
};

export const THROTTLE_MODE: IntSelectControl = {
  kind: "intSelect",
  key: "throttleMode",
  label: "Throttle mode (offroad mode)",
  section: "throttle",
  tooltip:
    "How the throttle behaves. Disabled. Pedaling required: only works while pedaling, stops when you stop. 6 km/h only: active only up to 6 km/h, even without pedaling. 6 km/h & pedaling: works without pedaling up to 6 km/h, needs pedaling above that. Unconditional: always active. Check your local legal restrictions on throttle use.",
  options: THROTTLE_MODE_OPTIONS,
  dependsOn: (v) => v.optionalAdcThrottle === true,
};

export const THROTTLE_MODE_STREET: IntSelectControl = {
  kind: "intSelect",
  key: "throttleModeOnStreetMode",
  label: "Throttle mode (street mode)",
  section: "throttle",
  tooltip:
    "Same choices as Throttle mode (offroad mode) above, applied while STREET mode is active. Only available with brake sensors installed and enabled.",
  options: THROTTLE_MODE_OPTIONS,
  dependsOn: (v) => v.optionalAdcThrottle === true && v.brakeSensor === true,
  hint: (v) =>
    v.optionalAdcThrottle === true && v.brakeSensor !== true
      ? "Disabled: needs Optional brake input (above) set to Brake sensor."
      : null,
};

export const radioControls: RadioControl[] = [BRAKE_FEATURE, OPTIONAL_ADC];
export const intSelectControls: IntSelectControl[] = [THROTTLE_MODE, THROTTLE_MODE_STREET];

export const fields: Record<string, ExplicitFieldMeta> = {
  adcThrottleMin: {
    label: "Throttle ADC min",
    section: "throttle",
    tooltip:
      "Raw ADC reading (0-255) at the throttle's minimum position, from calibration. Check the 'ADC throttle (8-bit)' value on the display with the throttle released.",
    dependsOn: (v) => v.optionalAdcThrottle === true,
  },
  adcThrottleMax: {
    label: "Throttle ADC max",
    section: "throttle",
    tooltip:
      "Raw ADC reading (0-255) at the throttle's maximum position, from calibration. Check the 'ADC throttle (8-bit)' value on the display with the throttle fully open.",
    dependsOn: (v) => v.optionalAdcThrottle === true,
  },
  coasterBrakeTorqueThreshold: {
    label: "Coaster brake torque threshold",
    section: "throttle",
    tooltip:
      "Sensitivity of the coaster brake, triggered by pushing the pedals backwards - lower values trigger on a lighter backward push. Default 15; start there and adjust to feel. Changing Torque ADC offset trim (Advanced torque calibration page) may require retuning this too.",
    dependsOn: (v) => v.coasterBrakeEnabled === true,
  },
  assistThrottleMin: {
    label: "Assist throttle min",
    section: "throttle",
    tooltip:
      "Throttle assist-scaling range, distinct from the raw ADC calibration (Throttle ADC min/max) above. Default 0-255 is the full 8-bit range - no additional clamp.",
    dependsOn: (v) => v.optionalAdcThrottle === true,
  },
  assistThrottleMax: {
    label: "Assist throttle max",
    section: "throttle",
    tooltip:
      "Throttle assist-scaling range, distinct from the raw ADC calibration (Throttle ADC min/max) above. Default 0-255 is the full 8-bit range - no additional clamp.",
    dependsOn: (v) => v.optionalAdcThrottle === true,
  },
};
