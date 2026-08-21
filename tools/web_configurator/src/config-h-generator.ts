// Generates src/config.h text, mirroring the pWriter block of
// TSDZ2_Configurator.java (lines 1431-2408) line for line and in the same
// order. That order is also config.h's own current line order - verified by
// diffing pWriter's output against the checked-in file.

import { ADC_PEDAL_TORQUE_ANGLE_ADJ_ARRAY, MIDDLE_ANGLE_ADJ, MIDDLE_OFFSET_ADJ, MIDDLE_RANGE_ADJ } from "./schema.ts";
import type { FieldValues } from "./ini-import.ts";

function b(values: FieldValues, key: string): boolean {
  return values[key] === true;
}
function n(values: FieldValues, key: string): number {
  const v = values[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  throw new Error(`Expected numeric field "${key}", got ${typeof v}`);
}
function s(values: FieldValues, key: string): string {
  return String(values[key]);
}

/** Signed-offset decode: raw ini value stored around MIDDLE - unused by the
 * generator (which re-emits the raw stored value), kept here for the UI
 * layer that displays/edits the signed delta. */
export function decodeSignedOffset(raw: number, middle: number): number {
  return raw - middle;
}
export function encodeSignedOffset(delta: number, middle: number): number {
  return middle + delta;
}

export function generateConfigH(values: FieldValues): string {
  const lines: string[] = [
    "/*",
    " * config.h",
    " *",
    " *  Automatically created by TSDZ2 Web Configurator",
    " *  (schema derived from TSDZ2_Configurator.java)",
    " */",
    "",
    "#ifndef CONFIG_H_",
    "#define CONFIG_H_",
    "",
  ];
  const define = (name: string, value: string | number) => lines.push(`#define ${name} ${value}`);

  // MOTOR_TYPE: 36V -> 1, else (48V or unset) -> 0.
  define("MOTOR_TYPE", b(values, "motorTypeTSDZ2_36V") ? 1 : 0);
  define("TORQUE_SENSOR_CALIBRATED", b(values, "torqueCalibration") ? 1 : 0);
  // Matches the Java writer's literal (accidental) double space exactly.
  lines.push(`#define MOTOR_ACCELERATION  ${n(values, "motorAcceleration")}`);
  define("MOTOR_ASSISTANCE_WITHOUT_PEDAL_ROTATION", b(values, "assistWithoutPedalRotation") ? 1 : 0);
  define("ASSISTANCE_WITHOUT_PEDAL_ROTATION_THRESHOLD", n(values, "assistWithoutPedalRotationThreshold"));
  define("PEDAL_TORQUE_PER_10_BIT_ADC_STEP_X100", n(values, "torqueAdcStep"));
  define("PEDAL_TORQUE_ADC_MAX", n(values, "torqueAdcMax"));
  define("STARTUP_BOOST_TORQUE_FACTOR", n(values, "startupBoostTorqueFactor"));
  define("MOTOR_BLOCKED_COUNTER_THRESHOLD", n(values, "motorBlockedCounterThreshold"));
  define("MOTOR_BLOCKED_BATTERY_CURRENT_THRESHOLD_X10", n(values, "motorBlockedBatteryCurrentThresholdX10"));
  define("MOTOR_BLOCKED_ERPS_THRESHOLD", n(values, "motorBlockedErpsThreshold"));
  define("STARTUP_BOOST_CADENCE_STEP", n(values, "startupBoostCadenceStep"));
  define("BATTERY_CURRENT_MAX", n(values, "batteryCurrentMax"));
  define("TARGET_MAX_BATTERY_POWER", n(values, "targetMaxBatteryPower"));
  define("TARGET_MAX_BATTERY_CAPACITY", n(values, "targetMaxBatteryCapacity"));
  define("BATTERY_CELLS_NUMBER", n(values, "batteryCellsNumber"));
  define("MOTOR_DECELERATION", n(values, "motorDeceleration"));
  define("BATTERY_LOW_VOLTAGE_CUT_OFF", n(values, "batteryLowVoltageCutOff"));
  define("ENABLE_BATTERY_SAG_INDICATOR", b(values, "batterySagIndicatorEnabled") ? 1 : 0);
  define("BATTERY_VOLTAGE_SAG_FILTER_SHIFT", n(values, "batteryVoltageSagFilterShift"));
  define("ACTUAL_BATTERY_VOLTAGE_PERCENT", n(values, "actualBatteryVoltagePercent"));
  define("ACTUAL_BATTERY_CAPACITY_PERCENT", n(values, "actualBatteryCapacityPercent"));
  define("LI_ION_CELL_OVERVOLT", s(values, "liIonCellOvervolt"));
  define("LI_ION_CELL_RESET_SOC_PERCENT", s(values, "liIonCellResetSocPercent"));
  define("LI_ION_CELL_VOLTS_FULL", s(values, "liIonCellVoltsFull"));
  define("LI_ION_CELL_VOLTS_3_OF_4", s(values, "liIonCellVolts3Of4"));
  define("LI_ION_CELL_VOLTS_2_OF_4", s(values, "liIonCellVolts2Of4"));
  define("LI_ION_CELL_VOLTS_1_OF_4", s(values, "liIonCellVolts1Of4"));
  define("LI_ION_CELL_VOLTS_5_OF_6", s(values, "liIonCellVolts5Of6"));
  define("LI_ION_CELL_VOLTS_4_OF_6", s(values, "liIonCellVolts4Of6"));
  define("LI_ION_CELL_VOLTS_3_OF_6", s(values, "liIonCellVolts3Of6"));
  define("LI_ION_CELL_VOLTS_2_OF_6", s(values, "liIonCellVolts2Of6"));
  define("LI_ION_CELL_VOLTS_1_OF_6", s(values, "liIonCellVolts1Of6"));
  define("LI_ION_CELL_VOLTS_EMPTY", s(values, "liIonCellVoltsEmpty"));
  define("WHEEL_PERIMETER", n(values, "wheelPerimeter"));
  define("WHEEL_MAX_SPEED", n(values, "wheelMaxSpeed"));
  define("ENABLE_LIGHTS", b(values, "lightsEnabled") ? 1 : 0);
  define("ENABLE_WALK_ASSIST", b(values, "walkAssistEnabled") ? 1 : 0);

  // Brake feature is a 4-way exclusive choice (disabled/sensor/coaster/temp
  // switch) spread across brakeSensor, coasterBrakeEnabled, temperatureSwitch.
  const brakeIsSensor = b(values, "brakeSensor");
  const brakeIsCoaster = b(values, "coasterBrakeEnabled");
  const brakeIsTempSwitch = b(values, "temperatureSwitch");
  define("ENABLE_BRAKE_SENSOR", brakeIsSensor || brakeIsTempSwitch ? 1 : 0);

  // Optional ADC is a 3-way exclusive choice (disabled/throttle/temperature).
  if (b(values, "optionalAdcTemperature")) {
    define("ENABLE_THROTTLE", 0);
    define("ENABLE_TEMPERATURE_LIMIT", 1);
  } else if (b(values, "optionalAdcThrottle")) {
    define("ENABLE_THROTTLE", 1);
    define("ENABLE_TEMPERATURE_LIMIT", 0);
  } else {
    define("ENABLE_THROTTLE", 0);
    define("ENABLE_TEMPERATURE_LIMIT", 0);
  }

  define("ENABLE_STREET_MODE_ON_STARTUP", b(values, "streetModeOnStart") ? 1 : 0);
  define("ENABLE_SET_PARAMETER_ON_STARTUP", b(values, "setParamOnStart") ? 1 : 0);
  define("ENABLE_ODOMETER_COMPENSATION", b(values, "odoCompensation") ? 1 : 0);
  define("STARTUP_BOOST_ON_STARTUP", b(values, "startupBoostOnStart") ? 1 : 0);
  define("TORQUE_SENSOR_ADV_ON_STARTUP", b(values, "torqueSensorAdvOnStart") ? 1 : 0);
  const lightsConfigurationOnStartup = n(values, "lightsConfigurationOnStartup");
  define("LIGHTS_CONFIGURATION_ON_STARTUP", lightsConfigurationOnStartup);

  // Assist mode on startup: 5-way exclusive (power/torque/cadence/emtb/hybrid).
  const ridingMode = b(values, "assistStartupTorque")
    ? 2
    : b(values, "assistStartupCadence")
      ? 3
      : b(values, "assistStartupEmtb")
        ? 4
        : b(values, "assistStartupHybrid")
          ? 5
          : 1; // power (default)
  define("RIDING_MODE_ON_STARTUP", ridingMode);

  // DZ40 has no lights-button menu to reach the E02/E03/E04 toggle sequence
  // these three configs exist for (see sections/lights.ts's own
  // dz40LightsConfigDead comment) - ui8_lights_configuration never leaves
  // LIGHTS_CONFIGURATION_ON_STARTUP on that hardware, so emit that same
  // value for all three DZ40 builds instead of whatever's separately
  // configured here (already dependsOn-disabled in the UI, but a value
  // sitting in a disabled field can still be stale from before a display
  // switch, or imported from a non-DZ40 .ini/.tsdz2.json) - a real setting
  // that can never take effect is worse than an honest, inert duplicate.
  const dz40 = b(values, "displayTypeDZ40");
  define("LIGHTS_CONFIGURATION_1", dz40 ? lightsConfigurationOnStartup : n(values, "lightsConfiguration1"));
  define("LIGHTS_CONFIGURATION_2", dz40 ? lightsConfigurationOnStartup : n(values, "lightsConfiguration2"));
  define("LIGHTS_CONFIGURATION_3", dz40 ? lightsConfigurationOnStartup : n(values, "lightsConfiguration3"));
  // Always 1: src/ has no #if on this macro anywhere, so STREET_MODE_POWER_LIMIT
  // applies unconditionally whenever street mode is on regardless of this value -
  // hardcoded rather than read from values.streetPowerLimEnabled (a dead field kept
  // only for old .ini/.tsdz2.json round-tripping, see DEAD_KEYS in ui-model.ts) so
  // config.h doesn't misreport "disabled" for a limit that's actually always live.
  define("STREET_MODE_POWER_LIMIT_ENABLED", 1);
  define("STREET_MODE_POWER_LIMIT", n(values, "streetModePowerLimit"));
  define("STREET_MODE_SPEED_LIMIT", n(values, "streetModeSpeedLimit"));

  const throttleModeOnStreet = n(values, "throttleModeOnStreetMode");
  define(
    "STREET_MODE_THROTTLE_ENABLED",
    b(values, "optionalAdcThrottle") && throttleModeOnStreet === 4 /* UNCONDITIONAL */ ? 1 : 0,
  );
  define("STREET_MODE_CRUISE_ENABLED", b(values, "streetCruiseEnabled") ? 1 : 0);
  define("ADC_THROTTLE_MIN_VALUE", n(values, "adcThrottleMin"));
  define("ADC_THROTTLE_MAX_VALUE", n(values, "adcThrottleMax"));
  define("MOTOR_TEMPERATURE_MIN_VALUE_LIMIT", n(values, "motorTempMin"));
  define("MOTOR_TEMPERATURE_MAX_VALUE_LIMIT", n(values, "motorTempMax"));
  define("ENABLE_TEMPERATURE_ERROR_MIN_LIMIT", b(values, "tempErrorMinLimitEnabled") ? 1 : 0);
  define("ENABLE_VLCD6", b(values, "displayTypeVLCD6") ? 1 : 0);
  // DZ40 is tracked as its own Display type option in the UI/save file (see
  // schema.ts's displayTypeDZ40 comment), but the firmware doesn't
  // distinguish it from VLCD5 yet - treat it as VLCD5 here for now.
  define("ENABLE_VLCD5", b(values, "displayTypeVLCD5") || b(values, "displayTypeDZ40") ? 1 : 0);
  define("ENABLE_XH18", b(values, "displayTypeXH18") ? 1 : 0);
  // Genuinely different firmware path from every other display type here -
  // not folded into an existing ENABLE_* flag the way DZ40 is folded into
  // ENABLE_VLCD5 above.
  define("ENABLE_860C_LVGL_UART", b(values, "displayType860C") ? 1 : 0);
  define("ENABLE_DISPLAY_WORKING_FLAG", b(values, "displayWorkingFlag") ? 1 : 0);
  define("ENABLE_DISPLAY_ALWAYS_ON", b(values, "displayAlwaysOn") ? 1 : 0);
  define("ENABLE_WHEEL_MAX_SPEED_FROM_DISPLAY", b(values, "maxSpeedFromDisplay") ? 1 : 0);
  define("DELAY_MENU_ON", n(values, "delayMenuOn"));
  define("COASTER_BRAKE_ENABLED", brakeIsCoaster ? 1 : 0);
  define("COASTER_BRAKE_TORQUE_THRESHOLD", n(values, "coasterBrakeTorqueThreshold"));
  define("ENABLE_AUTO_DATA_DISPLAY", b(values, "autoDisplayData") ? 1 : 0);
  define("STARTUP_ASSIST_ENABLED", b(values, "startupAssistEnabled") ? 1 : 0);
  define("DELAY_DISPLAY_DATA_1", n(values, "delayDisplayData1"));
  define("DELAY_DISPLAY_DATA_2", n(values, "delayDisplayData2"));
  define("DELAY_DISPLAY_DATA_3", n(values, "delayDisplayData3"));
  define("DELAY_DISPLAY_DATA_4", n(values, "delayDisplayData4"));
  define("DELAY_DISPLAY_DATA_5", n(values, "delayDisplayData5"));
  define("DELAY_DISPLAY_DATA_6", n(values, "delayDisplayData6"));
  define("DISPLAY_DATA_1", n(values, "displayData1"));
  define("DISPLAY_DATA_2", n(values, "displayData2"));
  define("DISPLAY_DATA_3", n(values, "displayData3"));
  define("DISPLAY_DATA_4", n(values, "displayData4"));
  define("DISPLAY_DATA_5", n(values, "displayData5"));
  define("DISPLAY_DATA_6", n(values, "displayData6"));
  define("POWER_ASSIST_LEVEL_1", n(values, "powerAssist1"));
  define("POWER_ASSIST_LEVEL_2", n(values, "powerAssist2"));
  define("POWER_ASSIST_LEVEL_3", n(values, "powerAssist3"));
  define("POWER_ASSIST_LEVEL_4", n(values, "powerAssist4"));
  define("TORQUE_ASSIST_LEVEL_1", n(values, "torqueAssist1"));
  define("TORQUE_ASSIST_LEVEL_2", n(values, "torqueAssist2"));
  define("TORQUE_ASSIST_LEVEL_3", n(values, "torqueAssist3"));
  define("TORQUE_ASSIST_LEVEL_4", n(values, "torqueAssist4"));
  define("CADENCE_ASSIST_LEVEL_1", n(values, "cadenceAssist1"));
  define("CADENCE_ASSIST_LEVEL_2", n(values, "cadenceAssist2"));
  define("CADENCE_ASSIST_LEVEL_3", n(values, "cadenceAssist3"));
  define("CADENCE_ASSIST_LEVEL_4", n(values, "cadenceAssist4"));
  define("EMTB_ASSIST_LEVEL_1", n(values, "emtbAssist1"));
  define("EMTB_ASSIST_LEVEL_2", n(values, "emtbAssist2"));
  define("EMTB_ASSIST_LEVEL_3", n(values, "emtbAssist3"));
  define("EMTB_ASSIST_LEVEL_4", n(values, "emtbAssist4"));
  define("WALK_ASSIST_LEVEL_1", n(values, "walkSpeed1"));
  define("WALK_ASSIST_LEVEL_2", n(values, "walkSpeed2"));
  define("WALK_ASSIST_LEVEL_3", n(values, "walkSpeed3"));
  define("WALK_ASSIST_LEVEL_4", n(values, "walkSpeed4"));
  define("WALK_ASSIST_THRESHOLD_SPEED_X10", n(values, "walkSpeedLimit"));
  define("WALK_ASSIST_DEBOUNCE_ENABLED", b(values, "walkTimeEnabled") ? 1 : 0);
  define("WALK_ASSIST_DEBOUNCE_TIME", n(values, "walkAssistTime"));
  define("CRUISE_TARGET_SPEED_LEVEL_1", n(values, "cruiseSpeed1"));
  define("CRUISE_TARGET_SPEED_LEVEL_2", n(values, "cruiseSpeed2"));
  define("CRUISE_TARGET_SPEED_LEVEL_3", n(values, "cruiseSpeed3"));
  define("CRUISE_TARGET_SPEED_LEVEL_4", n(values, "cruiseSpeed4"));
  define("CRUISE_MODE_WALK_ENABLED", b(values, "cruiseWithoutPedaling") ? 1 : 0);
  define("CRUISE_THRESHOLD_SPEED", n(values, "cruiseThresholdSpeed"));
  define("PEDAL_TORQUE_ADC_OFFSET", n(values, "torqueAdcOffset"));
  define("AUTO_DATA_NUMBER_DISPLAY", n(values, "autoDataNumberDisplay"));

  // Units: kilometers (or the alt-miles flag alone) -> 0; miles -> 0 if
  // VLCD6 else 1 (VLCD6's own display firmware already renders mph).
  const unitsKilometers = b(values, "unitsKilometers");
  const unitsMiles = b(values, "unitsMiles");
  const alternativeMiles = b(values, "alternativeMiles");
  const isVLCD6 = b(values, "displayTypeVLCD6");
  if (unitsKilometers || (!unitsMiles && alternativeMiles)) {
    define("UNITS_TYPE", 0);
  } else if (unitsMiles) {
    define("UNITS_TYPE", isVLCD6 ? 0 : 1);
  } else {
    define("UNITS_TYPE", 0);
  }

  define("ASSIST_THROTTLE_MIN_VALUE", n(values, "assistThrottleMin"));
  define("ASSIST_THROTTLE_MAX_VALUE", n(values, "assistThrottleMax"));
  define("STREET_MODE_WALK_ENABLED", b(values, "streetWalkEnabled") ? 1 : 0);

  // Data shown on startup: 3-way exclusive (none/SOC/volts).
  define("DATA_DISPLAY_ON_STARTUP", b(values, "startupSoc") ? 1 : b(values, "startupVolts") ? 2 : 0);

  define("FIELD_WEAKENING_ENABLED", b(values, "fieldWeakeningEnabled") ? 1 : 0);

  const torqueOffsetRaw = n(values, "torqueOffsetAdjRaw");
  define("PEDAL_TORQUE_ADC_OFFSET_ADJ", torqueOffsetRaw);
  const torqueRangeRaw = n(values, "torqueRangeAdjRaw");
  define("PEDAL_TORQUE_ADC_RANGE_ADJ", torqueRangeRaw);
  const torqueAngleRaw = Math.min(
    Math.max(n(values, "torqueAngleAdjRaw"), 0),
    ADC_PEDAL_TORQUE_ANGLE_ADJ_ARRAY.length - 1,
  );
  define("PEDAL_TORQUE_ADC_ANGLE_ADJ", ADC_PEDAL_TORQUE_ANGLE_ADJ_ARRAY[torqueAngleRaw]);
  define("PEDAL_TORQUE_PER_10_BIT_ADC_STEP_ADV_X100", n(values, "torqueAdcStepAdv"));

  // SOC calc: 3-way exclusive (auto/wh/volts).
  define("SOC_PERCENT_CALC", b(values, "socWh") ? 1 : b(values, "socVolts") ? 2 : 0);
  define("TORQUE_SENSOR_ESTIMATED", b(values, "adcStepEstimated") ? 1 : 0);

  // Startup boost-at-zero: 3-way exclusive (cadence/speed/auto), cadence is
  // the guaranteed fallback if a corrupt file leaves all three false
  // (mirrors the Java runtime safety net at loadSettings() line 455-456).
  const boostAtZero = b(values, "boostAtZeroSpeed") ? 1 : b(values, "boostAtZeroAuto") ? 2 : 0; // cadence (default/fallback)
  define("STARTUP_BOOST_AT_ZERO", boostAtZero);

  define("ENABLE_850C", b(values, "displayType850C") ? 1 : 0);
  // Like STREET_MODE_THROTTLE_ENABLED above, this is derived from the
  // throttle-mode selection, not from the dead throttleLegal_UNUSED ini
  // field (the Java tool never exposes a control for that field - it just
  // round-trips a value nothing else reads).
  define(
    "STREET_MODE_THROTTLE_LEGAL",
    b(values, "optionalAdcThrottle") && throttleModeOnStreet === 1 /* PEDALING */ ? 1 : 0,
  );
  define("BRAKE_TEMPERATURE_SWITCH", brakeIsTempSwitch ? 1 : 0);
  define("eMTB_BASED_ON_POWER", b(values, "eMtbTorque") ? 0 : 1);
  define("SMOOTH_START_ENABLED", b(values, "smoothStartEnabled") ? 1 : 0);
  define("SMOOTH_START_SET_PERCENT", n(values, "smoothStartRamp"));
  define("TEMPERATURE_SENSOR_TYPE", b(values, "temperatureSensorType") ? 1 : 0);
  define("CRUISE_MODE_ENABLED", b(values, "cruiseEnabled") ? 1 : 0);
  define("CRUISE_OVERRIDE_WALK_ECO_ENABLED", b(values, "cruiseOverrideEco") ? 1 : 0);
  define("CRUISE_OVERRIDE_WALK_TOUR_ENABLED", b(values, "cruiseOverrideTour") ? 1 : 0);
  define("CRUISE_OVERRIDE_WALK_SPORT_ENABLED", b(values, "cruiseOverrideSport") ? 1 : 0);
  define("CRUISE_OVERRIDE_WALK_TURBO_ENABLED", b(values, "cruiseOverrideTurbo") ? 1 : 0);
  define("THROTTLE_MODE", n(values, "throttleMode"));
  define("STREET_MODE_THROTTLE_MODE", n(values, "throttleModeOnStreetMode"));
  define("ASSIST_LEVEL_5_PERCENT", n(values, "assistLevel5Percent"));
  define("ALTERNATIVE_MILES", alternativeMiles || (unitsMiles && isVLCD6) ? 1 : 0);
  define("PWM_FREQ", b(values, "pwm18kHz") ? 18 : 19);
  define("OVERCURRENT_DELAY", n(values, "overcurrentDelay"));
  define("MOTOR_TYPE_TSDZ8", b(values, "motorTypeTSDZ8") ? 1 : 0);
  define("ENABLE_EKD01", b(values, "displayTypeEKD01") ? 1 : 0);

  // Assist level 5 mode: 0=disabled,1=before eco,2=after turbo.
  define("ASSIST_LEVEL_5_MODE", n(values, "assistLevel5Mode"));

  define("BATTERY_PACK_RESISTANCE", n(values, "batteryPackResistance"));
  define("TORQUE_MODES_BASED_ON_POWER", b(values, "torqueModesBasedOnPower") ? 1 : 0);
  define("POWER_BASED_REFERENCE_VOLTAGE", n(values, "torqueModesRefVolt"));

  lines.push("", "#endif /* CONFIG_H_ */", "");
  return lines.join("\n");
}

export { MIDDLE_OFFSET_ADJ, MIDDLE_RANGE_ADJ, MIDDLE_ANGLE_ADJ };
