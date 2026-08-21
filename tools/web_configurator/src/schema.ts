// Schema derived from tools/Java_Configurator_Source/src/TSDZ2_Configurator.java
// loadSettings() (lines 206-449) and the save writer (lines 1431-2408).
//
// The .ini format is a plain positional dump: one `in.readLine()` per line,
// read top to bottom with zero keys. This file gives that sequence real
// names, matching the exact order the Java tool reads (and writes) them.
// Do not reorder entries here — order is the .ini file format.
//
// Six of the fields at the tail are optional: they were appended over time,
// and loadSettings() falls back to a hardcoded default if the line is
// missing (older .ini files simply run out of lines). Those carry
// `tailGroup`, matching loadSettings()'s own grouping of the fallback
// blocks (there are 7 such groups in the source, not the 5 the plan
// doc's prose loosely described).

export type FieldType = "bool" | "int" | "string";

export interface RawField {
  /** Stable key for this .ini line / config.h value. */
  key: string;
  type: FieldType;
  /** Default applied when this field's line is missing from an older .ini (tail groups only). */
  default: boolean | number | string;
  /** Which optional trailing group this belongs to, if any (1-7, per loadSettings()). */
  tailGroup?: number;
  /**
   * True for the 3 torque-calibration trim fields that loadSettings() reads
   * unconditionally but null-checks individually (lines 337-339, 460-494) -
   * distinct from the 7 versioned tailGroup blocks, but same "missing line
   * falls back to a default" behavior if a truncated/corrupt file ends here.
   */
  optional?: boolean;
}

// The exact positional order of every `in.readLine()` in loadSettings(),
// including the two-flag motor-type pair and three-flag display-type set
// that the UI later collapses into single dropdowns.
export const RAW_FIELDS: RawField[] = [
  { key: "motorTypeTSDZ2_36V", type: "bool", default: false },
  { key: "motorTypeTSDZ2_48V", type: "bool", default: true },
  { key: "torqueCalibration", type: "bool", default: false },
  { key: "motorAcceleration", type: "int", default: 35 },
  { key: "assistWithoutPedalRotation", type: "bool", default: false },
  { key: "assistWithoutPedalRotationThreshold", type: "int", default: 20 },
  { key: "torqueAdcStep", type: "int", default: 67 },
  { key: "torqueAdcMax", type: "int", default: 300 },
  { key: "startupBoostTorqueFactor", type: "int", default: 300 },
  { key: "motorBlockedCounterThreshold", type: "int", default: 2 },
  { key: "motorBlockedBatteryCurrentThresholdX10", type: "int", default: 30 },
  { key: "motorBlockedErpsThreshold", type: "int", default: 20 },
  { key: "startupBoostCadenceStep", type: "int", default: 20 },
  { key: "batteryCurrentMax", type: "int", default: 18 },
  { key: "targetMaxBatteryPower", type: "int", default: 900 },
  { key: "targetMaxBatteryCapacity", type: "int", default: 480 },
  { key: "batteryCellsNumber", type: "int", default: 13 },
  { key: "motorDeceleration", type: "int", default: 25 },
  { key: "batteryLowVoltageCutOff", type: "int", default: 39 },
  { key: "actualBatteryVoltagePercent", type: "int", default: 100 },
  { key: "actualBatteryCapacityPercent", type: "int", default: 90 },
  { key: "liIonCellOvervolt", type: "string", default: "4.35" },
  { key: "liIonCellResetSocPercent", type: "string", default: "4.00" },
  { key: "liIonCellVoltsFull", type: "string", default: "4.00" },
  { key: "liIonCellVolts3Of4", type: "string", default: "3.85" },
  { key: "liIonCellVolts2Of4", type: "string", default: "3.60" },
  { key: "liIonCellVolts1Of4", type: "string", default: "3.35" },
  { key: "liIonCellVolts5Of6", type: "string", default: "3.85" },
  { key: "liIonCellVolts4Of6", type: "string", default: "3.76" },
  { key: "liIonCellVolts3Of6", type: "string", default: "3.60" },
  { key: "liIonCellVolts2Of6", type: "string", default: "3.44" },
  { key: "liIonCellVolts1Of6", type: "string", default: "3.26" },
  { key: "liIonCellVoltsEmpty", type: "string", default: "3.10" },
  { key: "wheelPerimeter", type: "int", default: 1627 },
  { key: "wheelMaxSpeed", type: "int", default: 59 },
  { key: "lightsEnabled", type: "bool", default: false },
  { key: "walkAssistEnabled", type: "bool", default: true },
  { key: "brakeSensor", type: "bool", default: true },
  { key: "optionalAdcDisabled", type: "bool", default: true },
  { key: "optionalAdcThrottle", type: "bool", default: false },
  { key: "optionalAdcTemperature", type: "bool", default: false },
  { key: "streetModeOnStart", type: "bool", default: false },
  { key: "setParamOnStart", type: "bool", default: true },
  { key: "odoCompensation", type: "bool", default: false },
  { key: "startupBoostOnStart", type: "bool", default: true },
  { key: "torqueSensorAdvOnStart", type: "bool", default: false },
  { key: "lightsConfigurationOnStartup", type: "int", default: 0 },
  { key: "assistStartupPower", type: "bool", default: true },
  { key: "assistStartupTorque", type: "bool", default: false },
  { key: "assistStartupCadence", type: "bool", default: false },
  { key: "assistStartupEmtb", type: "bool", default: false },
  { key: "lightsConfiguration1", type: "int", default: 1 },
  { key: "lightsConfiguration2", type: "int", default: 9 },
  { key: "lightsConfiguration3", type: "int", default: 10 },
  { key: "streetPowerLimEnabled", type: "bool", default: false },
  { key: "streetModePowerLimit", type: "int", default: 500 },
  { key: "streetModeSpeedLimit", type: "int", default: 59 },
  { key: "streetThrottleEnabled_UNUSED", type: "bool", default: false },
  { key: "streetCruiseEnabled", type: "bool", default: false },
  { key: "adcThrottleMin", type: "int", default: 47 },
  { key: "adcThrottleMax", type: "int", default: 176 },
  { key: "motorTempMin", type: "int", default: 65 },
  { key: "motorTempMax", type: "int", default: 95 },
  { key: "tempErrorMinLimitEnabled", type: "bool", default: false },
  { key: "displayTypeVLCD6", type: "bool", default: false },
  { key: "displayTypeVLCD5", type: "bool", default: true },
  { key: "displayTypeXH18", type: "bool", default: false },
  { key: "displayWorkingFlag", type: "bool", default: true },
  { key: "displayAlwaysOn", type: "bool", default: false },
  { key: "maxSpeedFromDisplay", type: "bool", default: false },
  { key: "delayMenuOn", type: "int", default: 50 },
  { key: "coasterBrakeEnabled", type: "bool", default: false },
  { key: "coasterBrakeTorqueThreshold", type: "int", default: 15 },
  { key: "autoDisplayData", type: "bool", default: false },
  { key: "startupAssistEnabled", type: "bool", default: false },
  { key: "delayDisplayData1", type: "int", default: 50 },
  { key: "delayDisplayData2", type: "int", default: 50 },
  { key: "delayDisplayData3", type: "int", default: 50 },
  { key: "delayDisplayData4", type: "int", default: 50 },
  { key: "delayDisplayData5", type: "int", default: 50 },
  { key: "delayDisplayData6", type: "int", default: 50 },
  { key: "displayData1", type: "int", default: 1 },
  { key: "displayData2", type: "int", default: 2 },
  { key: "displayData3", type: "int", default: 10 },
  { key: "displayData4", type: "int", default: 7 },
  { key: "displayData5", type: "int", default: 4 },
  { key: "displayData6", type: "int", default: 8 },
  { key: "powerAssist1", type: "int", default: 160 },
  { key: "powerAssist2", type: "int", default: 240 },
  { key: "powerAssist3", type: "int", default: 320 },
  { key: "powerAssist4", type: "int", default: 480 },
  { key: "torqueAssist1", type: "int", default: 50 },
  { key: "torqueAssist2", type: "int", default: 80 },
  { key: "torqueAssist3", type: "int", default: 120 },
  { key: "torqueAssist4", type: "int", default: 160 },
  { key: "cadenceAssist1", type: "int", default: 50 },
  { key: "cadenceAssist2", type: "int", default: 90 },
  { key: "cadenceAssist3", type: "int", default: 120 },
  { key: "cadenceAssist4", type: "int", default: 180 },
  { key: "emtbAssist1", type: "int", default: 60 },
  { key: "emtbAssist2", type: "int", default: 100 },
  { key: "emtbAssist3", type: "int", default: 160 },
  { key: "emtbAssist4", type: "int", default: 200 },
  { key: "walkSpeed1", type: "int", default: 30 },
  { key: "walkSpeed2", type: "int", default: 35 },
  { key: "walkSpeed3", type: "int", default: 40 },
  { key: "walkSpeed4", type: "int", default: 45 },
  { key: "walkSpeedLimit", type: "int", default: 60 },
  { key: "walkTimeEnabled", type: "bool", default: true },
  { key: "walkAssistTime", type: "int", default: 3 },
  { key: "cruiseSpeed1", type: "int", default: 12 },
  { key: "cruiseSpeed2", type: "int", default: 16 },
  { key: "cruiseSpeed3", type: "int", default: 20 },
  { key: "cruiseSpeed4", type: "int", default: 24 },
  { key: "cruiseWithoutPedaling", type: "bool", default: false },
  { key: "cruiseThresholdSpeed", type: "int", default: 10 },
  { key: "torqueAdcOffset", type: "int", default: 150 },
  { key: "autoDataNumberDisplay", type: "int", default: 2 },
  { key: "unitsKilometers", type: "bool", default: true },
  { key: "unitsMiles", type: "bool", default: false },
  { key: "assistThrottleMin", type: "int", default: 0 },
  { key: "assistThrottleMax", type: "int", default: 255 },
  { key: "streetWalkEnabled", type: "bool", default: true },
  { key: "assistStartupHybrid", type: "bool", default: false },
  { key: "startupNone", type: "bool", default: true },
  { key: "startupSoc", type: "bool", default: false },
  { key: "startupVolts", type: "bool", default: false },
  { key: "fieldWeakeningEnabled", type: "bool", default: false },
  // Signed-offset encoding: raw ini value is stored around a MIDDLE_*_ADJ
  // constant (20); the Java UI displays value-20 as a signed delta. These
  // are the "delicate" torque-sensor calibration trims - kept expert-only
  // in the UI per the plan (mirrors emmebrusa's refusal to expose
  // MOTOR_ROTOR_OFFSET_ANGLE/FOC_ANGLE_MULTIPLIER as plain user fields).
  { key: "torqueOffsetAdjRaw", type: "int", default: 20, optional: true },
  { key: "torqueRangeAdjRaw", type: "int", default: 20, optional: true },
  { key: "torqueAngleAdjRaw", type: "int", default: 20, optional: true },
  { key: "torqueAdcStepAdv", type: "int", default: 34 },
  { key: "socAuto", type: "bool", default: true },
  { key: "socWh", type: "bool", default: false },
  { key: "socVolts", type: "bool", default: false },
  { key: "adcStepEstimated", type: "bool", default: false },
  { key: "boostAtZeroCadence", type: "bool", default: true },
  { key: "boostAtZeroSpeed", type: "bool", default: false },
  { key: "displayType850C", type: "bool", default: false },
  { key: "throttleLegal_UNUSED", type: "bool", default: false },

  // --- Tail group 1: eMTB/smooth-start/temp-sensor/cruise/throttle-mode/assist-5%/alt-miles ---
  { key: "temperatureSwitch", type: "bool", default: false, tailGroup: 1 },
  { key: "eMtbPower", type: "bool", default: true, tailGroup: 1 },
  { key: "eMtbTorque", type: "bool", default: false, tailGroup: 1 },
  { key: "smoothStartEnabled", type: "bool", default: true, tailGroup: 1 },
  { key: "smoothStartRamp", type: "int", default: 35, tailGroup: 1 },
  { key: "temperatureSensorType", type: "bool", default: false, tailGroup: 1 }, // false=LM35, true=TMP36
  { key: "cruiseEnabled", type: "bool", default: true, tailGroup: 1 },
  { key: "throttleMode", type: "int", default: 0, tailGroup: 1 }, // derived from optionalAdcThrottle when absent
  { key: "throttleModeOnStreetMode", type: "int", default: 0, tailGroup: 1 }, // derived from streetThrottle/throttleLegal when absent
  { key: "assistLevel5Percent", type: "int", default: 60, tailGroup: 1 },
  { key: "alternativeMiles", type: "bool", default: false, tailGroup: 1 },

  // --- Tail group 2: PWM frequency ---
  { key: "pwm18kHz", type: "bool", default: false, tailGroup: 2 },
  { key: "pwm19kHz", type: "bool", default: true, tailGroup: 2 },
  { key: "overcurrentDelay", type: "int", default: 2, tailGroup: 2 },

  // --- Tail group 3: TSDZ8 flag (out of scope for this tool - passthrough only) ---
  { key: "motorTypeTSDZ8", type: "bool", default: false, tailGroup: 3 },

  // --- Tail group 4: EKD01 display + assist level 5 mode ---
  { key: "displayTypeEKD01", type: "bool", default: false, tailGroup: 4 },
  { key: "assistLevel5Mode", type: "int", default: 0, tailGroup: 4 }, // 0=disabled,1=before eco,2=after turbo

  // --- Tail group 5: boost-at-zero "auto" option ---
  { key: "boostAtZeroAuto", type: "bool", default: false, tailGroup: 5 },

  // --- Tail group 6: battery pack resistance ---
  { key: "batteryPackResistance", type: "int", default: 200, tailGroup: 6 },

  // --- Tail group 7: torque modes based on power ---
  { key: "torqueModesBasedOnPower", type: "bool", default: false, tailGroup: 7 },
  { key: "torqueModesRefVolt", type: "int", default: 36, tailGroup: 7 },

  // --- Tail group 8: cruise control override for walk assist SPORT/TURBO ---
  { key: "cruiseOverrideSport", type: "bool", default: false, tailGroup: 8 },
  { key: "cruiseOverrideTurbo", type: "bool", default: false, tailGroup: 8 },

  // --- Tail group 9: cruise control override for walk assist ECO/TOUR ---
  // (added after tail group 8 shipped - a separate group so a .tsdz2.json/.ini
  // saved before this addition, which already has tail group 8's 2 lines,
  // doesn't come up short and misread these as part of some other field)
  { key: "cruiseOverrideEco", type: "bool", default: false, tailGroup: 9 },
  { key: "cruiseOverrideTour", type: "bool", default: false, tailGroup: 9 },

  // --- Tail group 10: DZ40 tracked as its own Display type option, distinct
  // from VLCD5 in the UI/save file, but config-h-generator.ts still folds it
  // into ENABLE_VLCD5 - the firmware itself doesn't distinguish them yet.
  // This field is web-configurator-only bookkeeping (no Java tool or config.h
  // macro of its own), same as tail groups 8/9 - default false so every
  // older .ini/.tsdz2.json (which never made this distinction) keeps reading
  // as plain VLCD5.
  { key: "displayTypeDZ40", type: "bool", default: false, tailGroup: 10 },

  // --- Tail group 11: battery sag indicator (E11) - purely informational
  // display fault, doesn't disable the motor or change the underlying
  // undervoltage ramp-down (which runs unconditionally). Default true since
  // it's a strict improvement in visibility with no behavior downside; an
  // older .ini/.tsdz2.json that never had this field still gets it enabled.
  { key: "batterySagIndicatorEnabled", type: "bool", default: true, tailGroup: 11 },
  // Smoothing strength for the same undervoltage ramp-down check (motor.c) -
  // independent of the indicator toggle above, since it affects the real
  // ramp-down behavior itself, not just whether it's shown on the display.
  // Default 10 (~57ms time constant at the 18kHz/55.5us PWM period - see
  // sections/battery.ts's tooltip for the full timing rationale) matches
  // BATTERY_VOLTAGE_SAG_FILTER_SHIFT's config.h default.
  { key: "batteryVoltageSagFilterShift", type: "int", default: 10, tailGroup: 11 },

  // --- Tail group 12: 860C tracked as its own Display type option, using the
  // gated CRC16 UART protocol (ENABLE_860C_LVGL_UART) and the vendored LVGL
  // UI in firmwares/display/860C/ - a genuinely different firmware path from
  // every other display type here, not folded into an existing ENABLE_* flag.
  // Web-configurator-only bookkeeping, same as tail groups 8-10 - default
  // false so every older .ini/.tsdz2.json (which never had this option)
  // keeps reading as whatever it already was.
  { key: "displayType860C", type: "bool", default: false, tailGroup: 12 },
];

export const MIDDLE_OFFSET_ADJ = 20;
export const MIDDLE_RANGE_ADJ = 20;
export const MIDDLE_ANGLE_ADJ = 20;

// PEDAL_TORQUE_ADC_ANGLE_ADJ isn't the raw ini int - it's a lookup into this
// table (intAdcPedalTorqueAngleAdjArray in the Java source), indexed by the
// raw 0-40 value. Values are decreasing (bigger index -> smaller angle).
export const ADC_PEDAL_TORQUE_ANGLE_ADJ_ARRAY = [
  160, 138, 120, 107, 96, 88, 80, 74, 70, 66, 63, 59, 56, 52, 50, 47, 44, 42, 39, 37, 36, 35, 34, 33, 32, 31, 30, 29,
  28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
];

export function byKey(key: string): RawField {
  const f = RAW_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(`Unknown schema field: ${key}`);
  return f;
}
