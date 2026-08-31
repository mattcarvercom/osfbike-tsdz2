// Battery section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import {
  radio,
  motorVoltageOf,
  batteryVoltageOf,
  CELLS_TO_SYSTEM_VOLTAGE,
  type ExplicitFieldMeta,
  type RadioControl,
  type IntSelectControl,
} from "../control-types.ts";
export const SOC_CALC: RadioControl = radio(
  "State-of-charge calculation",
  "battery",
  ["socAuto", "socWh", "socVolts"],
  [
    { label: "Auto", values: { socAuto: true, socWh: false, socVolts: false } },
    { label: "Watt-hours", values: { socAuto: false, socWh: true, socVolts: false } },
    { label: "Volts", values: { socAuto: false, socWh: false, socVolts: true } },
  ],
  "How remaining battery percentage is calculated. Auto: Wh-used based, with automatic reset when voltage disagrees with it by more than 15% (handles starting on a partially-charged battery) - recommended. Watt-hours: Wh-used based only, resets to 100% only on a full charge or manually. Volts: voltage-based, less accurate but handy with two batteries of different capacities.",
);

export const BATTERY_CELL_COUNT: IntSelectControl = {
  kind: "intSelect",
  key: "batteryCellsNumber",
  label: "Battery cell count",
  section: "battery",
  required: true,
  tooltip: "Number of battery cells wired in series: 7 for 24V, 10 for 36V, 13 for 48V, 14 for 52V.",
  hint: (v) => {
    const motor = motorVoltageOf(v);
    const battery = batteryVoltageOf(v);
    return motor !== null && battery !== null && motor !== battery
      ? `This is a ${battery}V pack, but Motor type (Motor page) is set to ${motor}V - make sure that's intentional (over/under-volting), not a mismatch.`
      : null;
  },
  options: [
    { label: "7 (24V)", value: 7 },
    { label: "10 (36V)", value: 10 },
    { label: "13 (48V)", value: 13 },
    { label: "14 (52V)", value: 14 },
  ],
  toggleGroup: true,
};

export const radioControls: RadioControl[] = [SOC_CALC];
export const intSelectControls: IntSelectControl[] = [BATTERY_CELL_COUNT];

export const fields: Record<string, ExplicitFieldMeta> = {
  batteryCurrentMax: {
    label: "Battery current max (A)",
    section: "battery",
    required: true,
    tooltip:
      "Maximum current the battery may deliver. Check your battery's specs; the firmware clamps this to 22A regardless. Recommended max 12A for a 48V motor, 16A for a 36V motor. 18A was this fork's previous hard ceiling (marked on the slider) - above that, the original TSDZ2 controller-board hardware note this firmware ships with warns its stock controller shouldn't exceed 16A continuous, so anything past 18A assumes your controller board can actually take it. If set near the max, consider installing a temperature sensor.",
    sliderRange: { min: 0, max: 22 },
    dangerAbove: 18,
    recommendedValue: (v) =>
      v.motorTypeTSDZ2_48V === true
        ? { value: 12, label: "48V motor" }
        : v.motorTypeTSDZ2_36V === true
          ? { value: 16, label: "36V motor" }
          : null,
    safetyWarning: (v) => {
      const current = Number(v.batteryCurrentMax ?? 0);
      if (current <= 18) return null;
      return `Above 18A: this fork's firmware (src/main.h) allows up to 22A, but the original TSDZ2 controller-board hardware note warns its stock controller shouldn't exceed 16A continuous - going past 18A assumes your specific controller board (FETs/shunt) can actually handle it, not just that your battery/BMS can supply it. Confirm your controller's real current rating before riding at ${current}A, and watch motor/controller temperature closely the first few rides.`;
    },
  },
  targetMaxBatteryCapacity: {
    label: "Battery capacity (Wh)",
    section: "battery",
    required: true,
    tooltip: "Total battery capacity in Watt-hours (nominal voltage x Ah). Example: a 36V, 17.5Ah battery = 630Wh.",
    presetValues: (v) => {
      const voltage = CELLS_TO_SYSTEM_VOLTAGE[v.batteryCellsNumber as number];
      if (!voltage) return [];
      return [10, 15, 20].map((ah) => ({ value: ah * voltage, label: `${ah}Ah` }));
    },
  },
  batteryLowVoltageCutOff: {
    label: "Battery low-voltage cutoff (V)",
    section: "battery",
    required: true,
    tooltip:
      "Voltage below which the controller automatically lowers current to avoid dropping further. Example: 36V battery, 2.9V/cell cutoff x 10 cells = 29V. Higher values reduce range but extend battery life. This check runs every PWM cycle against a lightly-filtered instantaneous voltage reading (see Battery voltage sag filter below) - sustained high current draw on a partly-depleted pack (e.g. Cruise control holding a fixed target speed late in a ride) can dip below this threshold well before the battery is actually empty, ramping power down temporarily rather than cutting it off. Battery sag indicator (below) can show this happening live.",
    sliderRange: { min: 15, max: 50 },
    recommendedValue: (v) => {
      const cells = v.batteryCellsNumber;
      return typeof cells === "number" ? { value: cells * 3, label: `${cells} cells x 3V` } : null;
    },
  },
  batterySagIndicatorEnabled: {
    label: "Battery sag indicator",
    section: "battery",
    tooltip:
      "Shows a live fault light (E11) whenever the low-voltage cutoff above is actively reducing power - clears itself the moment voltage recovers, no reboot needed. Purely informational: turning this off doesn't change when or how the cutoff itself reacts, it only stops the display from showing it. On by default; turn it off if you'd rather not see \"the error that always happens a few miles before I get home\" and just ride through it like before.",
  },
  batteryVoltageSagFilterShift: {
    label: "Battery voltage sag filter",
    section: "battery",
    tooltip:
      "How much the low-voltage cutoff's voltage reading is smoothed before it's compared against the cutoff above - independent of the indicator toggle, since this affects the real cutoff behavior itself, not just whether it's shown. This is a bit-shift, so its effect roughly doubles per step, and the real-world timescale is much faster than it sounds: the PWM cycle this runs on is ~55.5us (18kHz), not milliseconds. 0 disables smoothing entirely (reacts to a single noisy ADC sample, ~55us). Default 10 (~57ms) is long enough to ride through a brief current-spike-induced dip without tripping, while still reacting to a genuinely dropping battery within well under a second. Maximum is 15 (~1.8s to settle, full reaction can take several seconds) - 16 and above is undefined behavior in C (shifting a 16-bit value by its own bit-width), a hard technical ceiling, not just a recommendation. Setting it too high has a real cost: example, at 15 the cutoff could lag several seconds behind a genuinely sagging pack under sustained load, letting it sit below its safe voltage that whole time - repeated over many rides, that kind of habitual over-discharge shortens Li-ion pack lifespan the same way any deep-discharge cycling does. Keep it well under the ceiling; the default is a reasonable middle ground.",
    sliderRange: { min: 0, max: 15 },
    dangerAbove: 13,
  },
  actualBatteryVoltagePercent: {
    label: "Battery voltage calibration (%)",
    section: "battery",
    tooltip:
      "Corrects the voltage shown on the display. A fully-charged 36V-nominal battery should read close to 42V - adjust one unit at a time until it does. Default 100 (no correction); real-world adjustments are typically small, within a few percent either way - a big correction usually means something else is miscalibrated (e.g. Battery cell count).",
  },
  actualBatteryCapacityPercent: {
    label: "Battery capacity calibration (%)",
    section: "battery",
    tooltip:
      "Sets the real usable capacity. Calibration: with the battery fully charged, the display should show 99.9%; ride until fully exhausted, note the residual %, and set this to (100 - residual).",
  },
  liIonCellOvervolt: {
    label: "Li-ion cell overvoltage (V)",
    section: "battery",
    kind: "text",
    tooltip:
      "Per-cell voltage above which ERROR_OVERVOLTAGE (E08) is reported - can trip if the cell count above is wrong. Default 4.35V, safely above a typical Li-ion cell's ~4.20V full-charge voltage; lower it only if you know your cell chemistry's real max is lower (e.g. some LiFePO4 packs).",
  },
  liIonCellResetSocPercent: {
    label: "SOC reset voltage (V)",
    section: "battery",
    kind: "text",
    tooltip:
      'Per-cell voltage above which the state-of-charge display auto-resets to 99.9% at power-on, if the battery is fully charged. Recommended 4.10-4.15V; lower values cause premature resets on a partially-charged battery. Only affects DZ40/VLCD5\'s own SOC-bar reset - the 860C has a completely separate, on-device Wh-based battery gauge with its own "Reset at voltage" field (Configurations -> Battery on the display itself, not here), unrelated to this one.',
    dependsOn: (v) => v.displayType860C !== true,
    hint: (v) => {
      const cells = v.batteryCellsNumber;
      const perCell = Number(v.liIonCellResetSocPercent ?? 0);
      return typeof cells === "number" && perCell > 0 ? `= ${(cells * perCell).toFixed(1)}V pack voltage` : null;
    },
  },
  liIonCellVoltsFull: {
    label: "Cell volts: full",
    section: "battery",
    kind: "text",
    tooltip:
      "Per-cell voltage for the full-charge display state (all bars). Default 4.00V. This and the thresholds below it should descend in step from this value down to Cell volts: empty, matching a Li-ion cell's real discharge curve - the pre-filled defaults already do this for a typical cell.",
  },
  liIonCellVolts3Of4: {
    label: "Cell volts: 3/4",
    section: "battery",
    kind: "text",
    tooltip: "Per-cell voltage threshold for the 3-of-4-bars charge state (VLCD6 and XH18 displays). Default 3.85V.",
    dependsOn: (v) => v.displayTypeVLCD6 === true || v.displayTypeXH18 === true,
  },
  liIonCellVolts2Of4: {
    label: "Cell volts: 2/4",
    section: "battery",
    kind: "text",
    tooltip: "Per-cell voltage threshold for the 2-of-4-bars charge state (VLCD6 and XH18 displays). Default 3.60V.",
    dependsOn: (v) => v.displayTypeVLCD6 === true || v.displayTypeXH18 === true,
  },
  liIonCellVolts1Of4: {
    label: "Cell volts: 1/4",
    section: "battery",
    kind: "text",
    tooltip: "Per-cell voltage threshold for the 1-of-4-bars charge state (VLCD6 and XH18 displays). Default 3.35V.",
    dependsOn: (v) => v.displayTypeVLCD6 === true || v.displayTypeXH18 === true,
  },
  liIonCellVolts5Of6: {
    label: "Cell volts: 5/6",
    section: "battery",
    kind: "text",
    tooltip:
      "Per-cell voltage threshold for the 5-of-6-bars charge state (VLCD5/DZ40, 850C, and EKD01 displays). Default 3.85V.",
    dependsOn: (v) =>
      v.displayTypeDZ40 === true ||
      v.displayTypeVLCD5 === true ||
      v.displayType850C === true ||
      v.displayTypeEKD01 === true,
  },
  liIonCellVolts4Of6: {
    label: "Cell volts: 4/6",
    section: "battery",
    kind: "text",
    tooltip:
      "Per-cell voltage threshold for the 4-of-6-bars charge state (VLCD5/DZ40, 850C, and EKD01 displays). Default 3.76V.",
    dependsOn: (v) =>
      v.displayTypeDZ40 === true ||
      v.displayTypeVLCD5 === true ||
      v.displayType850C === true ||
      v.displayTypeEKD01 === true,
  },
  liIonCellVolts3Of6: {
    label: "Cell volts: 3/6",
    section: "battery",
    kind: "text",
    tooltip:
      "Per-cell voltage threshold for the 3-of-6-bars charge state (VLCD5/DZ40, 850C, and EKD01 displays). Default 3.60V.",
    dependsOn: (v) =>
      v.displayTypeDZ40 === true ||
      v.displayTypeVLCD5 === true ||
      v.displayType850C === true ||
      v.displayTypeEKD01 === true,
  },
  liIonCellVolts2Of6: {
    label: "Cell volts: 2/6",
    section: "battery",
    kind: "text",
    tooltip:
      "Per-cell voltage threshold for the 2-of-6-bars charge state (VLCD5/DZ40, 850C, and EKD01 displays). Default 3.44V.",
    dependsOn: (v) =>
      v.displayTypeDZ40 === true ||
      v.displayTypeVLCD5 === true ||
      v.displayType850C === true ||
      v.displayTypeEKD01 === true,
  },
  liIonCellVolts1Of6: {
    label: "Cell volts: 1/6",
    section: "battery",
    kind: "text",
    tooltip:
      "Per-cell voltage threshold for the 1-of-6-bars charge state (VLCD5/DZ40, 850C, and EKD01 displays). Default 3.26V.",
    dependsOn: (v) =>
      v.displayTypeDZ40 === true ||
      v.displayTypeVLCD5 === true ||
      v.displayType850C === true ||
      v.displayTypeEKD01 === true,
  },
  liIonCellVoltsEmpty: {
    label: "Cell volts: empty",
    section: "battery",
    kind: "text",
    tooltip:
      "Per-cell no-load voltage for the fully-discharged display state (0 bars). This is not the low-voltage cutoff. Default 3.10V.",
  },
  batteryPackResistance: {
    label: "Battery pack resistance (mOhm)",
    section: "battery",
    required: true,
    tooltip:
      "Compensates the state-of-charge display for voltage sag under load. Default 200 (typical 36V, 500-600Wh, 18650-cell pack); usual range 100-300. Higher voltage, fewer parallel cells, an aged pack, or 21700 cells all push this higher; more parallel cells push it lower.",
  },
};
