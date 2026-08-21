// Motor section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import {
  radio,
  motorVoltageOf,
  batteryVoltageOf,
  type ExplicitFieldMeta,
  type RadioControl,
  type IntSelectControl,
} from "../control-types.ts";
export const MOTOR_TYPE: RadioControl = {
  ...radio(
    "Motor type",
    "motor",
    ["motorTypeTSDZ2_36V", "motorTypeTSDZ2_48V"],
    [
      { label: "TSDZ2/TSDZ2B 48V", values: { motorTypeTSDZ2_36V: false, motorTypeTSDZ2_48V: true } },
      { label: "TSDZ2/TSDZ2B 36V", values: { motorTypeTSDZ2_36V: true, motorTypeTSDZ2_48V: false } },
    ],
    // "TSDZ2B" doesn't appear anywhere in src/*.c/*.h (confirmed by grep) -
    // the only voltage-class-relevant compile-time flag is MOTOR_TYPE (36V
    // vs 48V, main.h:91's FOC angle multiplier), same for both. TSDZ2B is
    // the currently-sold revision of this same motor family, not a
    // functionally distinct one - see UNIVERSAL_FIRMWARE_PLAN.md's own
    // investigation note on this.
    "Read this from the motor's plate data. This is the motor's voltage class, not the battery voltage. TSDZ2B is the current, commonly-sold revision of this same motor - firmware and this configurator treat it identically to the older TSDZ2, so just pick the matching voltage class regardless of which one's printed on yours. Motor wattage (e.g. the 750W often printed on the nameplate) is the same either way too - it's a marketing rating of the motor itself, not something this choice or the firmware caps; real power draw is set by Battery current max and the Offroad/Street power limits instead.",
    undefined,
    true,
  ),
  hint: (v) => {
    const motor = motorVoltageOf(v);
    const battery = batteryVoltageOf(v);
    return motor !== null && battery !== null && motor !== battery
      ? `Battery cell count (Battery page) implies a ${battery}V pack, not ${motor}V - make sure that's intentional (over/under-volting), not a mismatch.`
      : null;
  },
};

export const PWM_FREQ: RadioControl = {
  ...radio(
    "PWM frequency",
    "motor",
    ["pwm18kHz", "pwm19kHz"],
    [
      { label: "18 kHz", values: { pwm18kHz: true, pwm19kHz: false } },
      { label: "19 kHz", values: { pwm18kHz: false, pwm19kHz: true } },
    ],
    "Motor PWM switching frequency. 18 kHz (default) reaches 110 rpm cadence with the best efficiency. 19 kHz reaches almost 120 rpm but costs about 1% efficiency, and reaching that top cadence also needs Field weakening enabled.",
  ),
  // Not a firmware-enforced link (confirmed in src/ebike_app.c: FIELD_WEAKENING_ENABLED
  // has no dependency on PWM_FREQ or vice versa) - just a nudge, since picking 19 kHz
  // for its top cadence without also flipping the other switch (now on this same page,
  // see fieldWeakeningEnabled's section below) is an easy thing to miss.
  hint: (v) =>
    v.pwm19kHz === true && v.fieldWeakeningEnabled !== true
      ? "19 kHz alone won't reach its ~120rpm top cadence - also enable Field weakening below."
      : null,
};

export const radioControls: RadioControl[] = [MOTOR_TYPE, PWM_FREQ];
export const intSelectControls: IntSelectControl[] = [];

export const fields: Record<string, ExplicitFieldMeta> = {
  motorAcceleration: {
    label: "Motor acceleration",
    section: "motor",
    required: true,
    // ebike_app_init() (src/ebike_app.c) feeds this straight into map_ui8(),
    // whose input range is hardcoded 0-100 - same shape as Motor deceleration
    // right below it. map_ui8() clamps any input >= in_max to out_max, so
    // 100 and 255 (the raw uint8_t's real storage ceiling) produce the exact
    // same fastest-ramp result - nothing above 100 does anything more.
    tooltip:
      "0% = slowest ramp-up (gentlest start), 100% = fastest ramp-up (firmware clamps anything at or above 100 to the same fastest result - values above 100 have no additional effect). Start low and increase gradually - higher values stress the transmission more. Default 35. Suggested starting points: 36V motor/36V battery 35, 36V motor/48V battery 5, 36V motor/52V battery 0, 48V motor/36V battery 45, 48V motor/48V battery 35, 48V motor/52V battery 30.",
    sliderRange: { min: 0, max: 100 },
  },
  motorBlockedCounterThreshold: {
    label: "Motor-blocked counter threshold",
    section: "motor",
    tooltip:
      "How many consecutive 100ms ticks the over-current / under-speed condition below must hold before the controller reports ERROR_MOTOR_BLOCKED (E04). Range 0-255, default 2 (~0.2s).",
  },
  motorBlockedBatteryCurrentThresholdX10: {
    label: "Motor-blocked current threshold (x10)",
    section: "motor",
    tooltip:
      "Battery current (x10, so 30 = 3.0A) above which the motor-blocked watchdog starts counting, if motor speed is also below the ERPS threshold below. Range 0-255 (0-25.5A), default 30 (3.0A).",
  },
  motorBlockedErpsThreshold: {
    label: "Motor-blocked ERPS threshold",
    section: "motor",
    tooltip:
      "Motor speed (ERPS - electrical RPM, not wheel/pedal RPM) below which, combined with high battery current, the motor-blocked watchdog starts counting. Range 0-255, default 20.",
  },
  motorDeceleration: {
    label: "Motor deceleration",
    section: "motor",
    required: true,
    tooltip:
      "Motor deceleration ramp. 0% = slowest stop (max ramp), 100% = fastest stop (min ramp). Recommended 25-45.",
    sliderRange: { min: 0, max: 100 },
  },
  fieldWeakeningEnabled: {
    label: "Field weakening enabled",
    section: "motor",
    tooltip: "Increases motor cadence up to 120rpm (at the cost of some efficiency) once PWM duty reaches 100%.",
  },
  overcurrentDelay: {
    label: "Overcurrent delay",
    section: "motor",
    tooltip:
      "How long (x25ms steps) an overcurrent condition must persist before tripping ERROR_OVERCURRENT (E07) and protecting the controller/gears. Valid 1-5, recommended 2; 0 disables the check - only raise this if you're getting unwanted trips.",
  },
};
