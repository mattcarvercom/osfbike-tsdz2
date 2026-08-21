// Display section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { radio, type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
import type { FieldValues } from "../ini-import.ts";

// DZ40 and 860C both leave this tool's classic display-data-cycling system
// (DELAY_MENU_ON/ENABLE_AUTO_DATA_DISPLAY/DISPLAY_DATA_1-6 in config.h) with
// nothing to act on, for two unrelated reasons: DZ40's two-digit readout has
// no menu button to reach a data-cycling screen at all, while 860C compiles
// in a different receive path entirely (ENABLE_860C_LVGL_UART's
// communications_controller()/communications_process_packages()) that
// replaces uart_receive_package() -
// the function these fields' config.h macros are consumed by - rather than
// running alongside it. 860C has its own on-device LVGL config screen
// instead. Same practical effect (the fields do nothing), different reason,
// so the two get their own message rather than sharing DZ40's.
function classicMenuCyclingNote(v: FieldValues): string | null {
  if (v.displayTypeDZ40 === true) {
    return "DZ40 only has a two-digit readout (speed/gear) with no menu button to reach a data-cycling screen - it can't show the Display data 1-6 readouts, so everything from here down is disabled for this display type.";
  }
  if (v.displayType860C === true) {
    return "860C uses the new CRC16 UART protocol and its own on-device LVGL config screen instead of this classic menu-cycling system - these fields have no effect on that firmware path, so everything from here down is disabled for this display type.";
  }
  return null;
}

function classicMenuCyclingLive(v: FieldValues): boolean {
  return v.displayTypeDZ40 !== true && v.displayType860C !== true;
}
// Codes verified against src/ebike_app.c's ui8_data_index_array switch (~line
// 3288) - the readout shown for each of the 6 auto-cycling data slots.
const DISPLAY_DATA_OPTIONS: { label: string; value: number }[] = [
  { label: "0 - Motor temperature (needs sensor)", value: 0 },
  { label: "1 - Battery SOC %", value: 1 },
  { label: "2 - Battery voltage (stabilized)", value: 2 },
  { label: "3 - Battery current", value: 3 },
  { label: "4 - Motor power / 10", value: 4 },
  { label: "5 - Throttle ADC (8-bit)", value: 5 },
  { label: "6 - Torque sensor ADC (10-bit)", value: 6 },
  { label: "7 - Cadence (RPM)", value: 7 },
  { label: "8 - Human power / 10", value: 8 },
  { label: "9 - Torque sensor range (10-bit)", value: 9 },
  { label: "10 - Wh consumed", value: 10 },
  { label: "11 - Motor speed (ERPS)", value: 11 },
  { label: "12 - Duty cycle PWM %", value: 12 },
  { label: "13 - Battery voltage (unstabilized)", value: 13 },
];

function displayDataSelect(n: number): IntSelectControl {
  return {
    kind: "intSelect",
    key: `displayData${n}`,
    label: `Display data ${n}`,
    section: "display",
    tooltip: `Data slot ${n} shown when auto-cycling (or always, for slot 1, if auto-cycling is off).`,
    options: DISPLAY_DATA_OPTIONS,
    dependsOn: classicMenuCyclingLive,
  };
}

const DISPLAY_DATA_SELECTS: IntSelectControl[] = [1, 2, 3, 4, 5, 6].map(displayDataSelect);

export const DISPLAY_TYPE: RadioControl = {
  ...radio(
    "Display type",
    "display",
    [
      "displayTypeDZ40",
      "displayTypeVLCD5",
      "displayTypeVLCD6",
      "displayTypeXH18",
      "displayType850C",
      "displayTypeEKD01",
      "displayType860C",
    ],
    [
      {
        label: "DZ40",
        image: "/displays/DZ40.png",
        values: {
          displayTypeDZ40: true,
          displayTypeVLCD5: false,
          displayTypeVLCD6: false,
          displayTypeXH18: false,
          displayType850C: false,
          displayTypeEKD01: false,
          displayType860C: false,
        },
      },
      {
        label: "VLCD5",
        image: "/displays/VLCD5.png",
        values: {
          displayTypeDZ40: false,
          displayTypeVLCD5: true,
          displayTypeVLCD6: false,
          displayTypeXH18: false,
          displayType850C: false,
          displayTypeEKD01: false,
          displayType860C: false,
        },
      },
      {
        label: "VLCD6",
        image: "/displays/VLCD6.png",
        values: {
          displayTypeDZ40: false,
          displayTypeVLCD5: false,
          displayTypeVLCD6: true,
          displayTypeXH18: false,
          displayType850C: false,
          displayTypeEKD01: false,
          displayType860C: false,
        },
      },
      {
        label: "XH18",
        image: "/displays/XH18.png",
        values: {
          displayTypeDZ40: false,
          displayTypeVLCD5: false,
          displayTypeVLCD6: false,
          displayTypeXH18: true,
          displayType850C: false,
          displayTypeEKD01: false,
          displayType860C: false,
        },
      },
      {
        label: "850C",
        image: "/displays/850C.png",
        values: {
          displayTypeDZ40: false,
          displayTypeVLCD5: false,
          displayTypeVLCD6: false,
          displayTypeXH18: false,
          displayType850C: true,
          displayTypeEKD01: false,
          displayType860C: false,
        },
      },
      {
        label: "EKD01",
        image: "/displays/EKD01.png",
        values: {
          displayTypeDZ40: false,
          displayTypeVLCD5: false,
          displayTypeVLCD6: false,
          displayTypeXH18: false,
          displayType850C: false,
          displayTypeEKD01: true,
          displayType860C: false,
        },
      },
      {
        label: "860C",
        image: "/displays/860C.png",
        values: {
          displayTypeDZ40: false,
          displayTypeVLCD5: false,
          displayTypeVLCD6: false,
          displayTypeXH18: false,
          displayType850C: false,
          displayTypeEKD01: false,
          displayType860C: true,
        },
      },
    ],
    "Type of stock display connected. Determines which set of battery charge-bar voltage thresholds (Battery page) is used (DZ40, VLCD5, 850C, and EKD01 have 6 bars, VLCD6/XH18 have 4), plus several other display-specific behaviors (fault code handling, menu timing, and more). DZ40 is tracked separately here so a future update can give it its own UI behavior, but the firmware itself still treats it identically to VLCD5 for now. 860C uses a genuinely different firmware path - the new CRC16 UART protocol (ENABLE_860C_LVGL_UART) and its own on-device LVGL config screen, not this tool's classic display-data-cycling fields. Grayed-out entries are displays this configurator doesn't support yet.",
    undefined,
    true,
  ),
  visualPicker: true,
  unimplementedOptions: [
    { label: "SW102", image: "/displays/SW102.png" },
    { label: "SW2-M58", image: "/displays/SW2-M58.png" },
  ],
};

export const DISPLAY_MODE: RadioControl = radio(
  "Display mode",
  "display",
  ["displayWorkingFlag", "displayAlwaysOn"],
  [
    { label: "Working on", values: { displayWorkingFlag: true, displayAlwaysOn: false } },
    { label: "Always on", values: { displayWorkingFlag: false, displayAlwaysOn: true } },
  ],
  "Working on: the display turns off after 5 minutes of inactivity. Always on: it never turns off automatically.",
);

export const UNITS: RadioControl = radio(
  "Speed units",
  "display",
  ["unitsKilometers", "unitsMiles", "alternativeMiles"],
  [
    { label: "km/h", values: { unitsKilometers: true, unitsMiles: false, alternativeMiles: false } },
    { label: "mph", values: { unitsKilometers: false, unitsMiles: true, alternativeMiles: false } },
    {
      label: "alt. mph (set km/h on display)",
      values: { unitsKilometers: false, unitsMiles: false, alternativeMiles: true },
    },
  ],
  "Units for speed and the odometer - set the display itself to match. 'Alt. mph' is for displays like VLCD6 with no built-in km-to-mile conversion: set the display to km/h and this option converts for you, avoiding an odometer scale jump on displays that do convert internally.",
);

// Moved here from the now-removed "Power-on defaults" page - it's purely
// about what the display itself shows, so it belongs with this page's other
// display-behavior radios rather than off on its own, shared with two
// unrelated assist/riding-mode fields.
export const DATA_ON_STARTUP: RadioControl = radio(
  "Data shown on power-on",
  "display",
  ["startupNone", "startupSoc", "startupVolts"],
  [
    { label: "None", values: { startupNone: true, startupSoc: false, startupVolts: false } },
    { label: "State of charge", values: { startupNone: false, startupSoc: true, startupVolts: false } },
    { label: "Volts", values: { startupNone: false, startupSoc: false, startupVolts: true } },
  ],
  "What the display shows briefly at power on, before switching to the normal ride display.",
);

export const radioControls: RadioControl[] = [DISPLAY_TYPE, DISPLAY_MODE, UNITS, DATA_ON_STARTUP];
export const intSelectControls: IntSelectControl[] = [...DISPLAY_DATA_SELECTS];

export const fields: Record<string, ExplicitFieldMeta> = {
  wheelPerimeter: {
    label: "Wheel circumference (mm)",
    section: "display",
    required: true,
    distanceField: "mm",
    tooltip:
      "Wheel circumference in millimeters, used to calculate speed and distance. Typical: 26in=2050, 27in=2150, 27.5in=2215, 28in=2250, 29in=2300. Measure the actual circumference and cross-check against GPS distance.",
  },
  maxSpeedFromDisplay: {
    label: "Max speed read from display",
    section: "display",
    tooltip:
      "Uses the speed limit configured on the display instead of Offroad-mode speed limit. The street speed limit always stays active in STREET mode; when both apply, whichever is lower wins.",
  },
  // Not really a "Power-on defaults" field despite ENABLE_SET_PARAMETER_ON_
  // STARTUP's name (where it used to live, in sections/startup.ts) - it's
  // about the display's own on-bike settings menu, so it belongs with the
  // rest of this page. Placed right after Max speed read from display (see
  // ui-model.ts's own moveBefore call for this) since both are about what
  // the display itself can do independent of this web configurator.
  setParamOnStart: {
    label: "Display settings menu enabled",
    section: "display",
    tooltip:
      "Unlocks the display's own on-bike settings menu (separate from this web configurator, and much narrower - only a handful of EEPROM-backed fields, like Street mode and Auto display data, are reachable there; everything else in this tool is compiled into the firmware and only changes via a real reflash). With this off, that menu can't be opened at all. To open it: at assist level 0/OFF, press the lights button on/off twice until code E02 (SET PARAMETER) flashes. See the display's operating manual for the full menu. Important: this only seeds the EEPROM value on a genuinely blank/erased chip - src/eeprom.c's EEPROM_init() only rewrites EEPROM from config.h when its stored key byte doesn't match, and an ordinary firmware reflash doesn't touch that separate EEPROM region, so this checkbox has no effect on a controller that's already been flashed before. The display's own on/off toggle for this same setting (inside the menu this unlocks) is what actually controls it from then on.",
  },
  delayMenuOn: {
    // Was the display section's page-level dynamicNote (rendered above every
    // field, including Display type itself) - moved to sit right above this
    // field instead (noteBefore, not hint - this needs to read as its own
    // box below Max speed read from display's divider, not squeezed inside
    // that field's own box), since this is the first field the note's
    // "disabled from here down" actually applies to.
    noteBefore: classicMenuCyclingNote,
    // Was labeled "(ms)", contradicting this field's own tooltip ("x0.1s") -
    // the tooltip is correct: DELAY_MENU_ON's default of 50 makes sense as
    // ~5s (a real menu-confirmation window), not 50ms. Same counter family
    // as walkAssistTime - see that field's tooltip for the underlying
    // "increments once per UART packet" mechanism.
    label: "Menu delay (x0.1s)",
    section: "display",
    tooltip:
      "Time limit (~0.1s per unit, e.g. 50 means ~5s) between pressing the lights button to enter parameter-setting mode and confirming, and between confirming one parameter and moving to the next. Also the display time for Data shown on power-on. Max 255 (25.5s), default 50 (~5s).",
    dependsOn: classicMenuCyclingLive,
  },
  autoDisplayData: {
    label: "Auto-cycle display data",
    section: "display",
    tooltip:
      "Automatically cycles through the Display data 1-6 readouts in sequence when the lights are turned on. Also toggleable from some displays.",
    dependsOn: classicMenuCyclingLive,
  },
  delayDisplayData1: {
    label: "Display data 1 delay (0.1s)",
    section: "display",
    tooltip:
      "How long each of the 6 Display data slots is shown before advancing to the next one; 0 shows that slot indefinitely. Max 255 (25.5s). Set per slot - a slot you want to linger on can use a higher value than the others.",
    dependsOn: (v) => v.autoDisplayData === true && classicMenuCyclingLive(v),
  },
  delayDisplayData2: {
    label: "Display data 2 delay (0.1s)",
    section: "display",
    tooltip:
      "How long each of the 6 Display data slots is shown before advancing to the next one; 0 shows that slot indefinitely. Max 255 (25.5s). Set per slot - a slot you want to linger on can use a higher value than the others.",
    dependsOn: (v) => v.autoDisplayData === true && classicMenuCyclingLive(v),
  },
  delayDisplayData3: {
    label: "Display data 3 delay (0.1s)",
    section: "display",
    tooltip:
      "How long each of the 6 Display data slots is shown before advancing to the next one; 0 shows that slot indefinitely. Max 255 (25.5s). Set per slot - a slot you want to linger on can use a higher value than the others.",
    dependsOn: (v) => v.autoDisplayData === true && classicMenuCyclingLive(v),
  },
  delayDisplayData4: {
    label: "Display data 4 delay (0.1s)",
    section: "display",
    tooltip:
      "How long each of the 6 Display data slots is shown before advancing to the next one; 0 shows that slot indefinitely. Max 255 (25.5s). Set per slot - a slot you want to linger on can use a higher value than the others.",
    dependsOn: (v) => v.autoDisplayData === true && classicMenuCyclingLive(v),
  },
  delayDisplayData5: {
    label: "Display data 5 delay (0.1s)",
    section: "display",
    tooltip:
      "How long each of the 6 Display data slots is shown before advancing to the next one; 0 shows that slot indefinitely. Max 255 (25.5s). Set per slot - a slot you want to linger on can use a higher value than the others.",
    dependsOn: (v) => v.autoDisplayData === true && classicMenuCyclingLive(v),
  },
  delayDisplayData6: {
    label: "Display data 6 delay (0.1s)",
    section: "display",
    tooltip:
      "How long each of the 6 Display data slots is shown before advancing to the next one; 0 shows that slot indefinitely. Max 255 (25.5s). Set per slot - a slot you want to linger on can use a higher value than the others.",
    dependsOn: (v) => v.autoDisplayData === true && classicMenuCyclingLive(v),
  },
  autoDataNumberDisplay: {
    label: "Auto-display data count",
    section: "display",
    tooltip: "How many of the Display data 1-6 slots to cycle through (1-6).",
    dependsOn: (v) => v.autoDisplayData === true && classicMenuCyclingLive(v),
  },
};
