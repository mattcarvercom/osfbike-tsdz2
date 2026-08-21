// Advanced torque calibration section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
export const radioControls: RadioControl[] = [];
export const intSelectControls: IntSelectControl[] = [];

export const fields: Record<string, ExplicitFieldMeta> = {
  torqueAdcStep: {
    label: "Torque ADC step (x100)",
    section: "advanced",
    tooltip:
      "Conversion factor between pedal torque and the assistance %/human-power figures shown on the display, in Power assist mode. Range 0-255, default 67. Used only with Torque sensor advanced disabled - see Torque ADC step advanced for the calibrated equivalent.",
    dependsOn: (v) => v.torqueSensorAdvOnStart !== true,
  },
  torqueAdcMax: {
    label: "Torque ADC max",
    section: "advanced",
    tooltip:
      "Raw torque-sensor ADC reading at maximum pedal thrust (rider standing on the right pedal, horizontal), from the display's calibration procedure - don't guess this, run the procedure. Default 300, typically in the low hundreds. Don't use this to change the sensor's amplification - use Torque ADC range trim for that.",
  },
  torqueSensorAdvOnStart: {
    label: "Advanced torque sensor on power-on",
    section: "advanced",
    tooltip:
      "Selects which torque-sensor calibration formula is used at power on (also toggleable from some displays). With Torque sensor calibrated also enabled, the motor uses the entered calibration values, optionally refined by the ADC range/angle trims. With this disabled, the motor uses the simplified/alternative calibration instead.",
  },
  torqueAdcOffset: {
    label: "Torque ADC offset",
    section: "advanced",
    tooltip:
      "Raw torque-sensor ADC reading with no push on the pedals, from the display's calibration procedure - don't guess this, run the procedure. Default 150, typically in the low hundreds. Don't use this to change start sensitivity - use Torque ADC offset trim for that.",
  },
  torqueAdcStepAdv: {
    label: "Torque ADC step, advanced (x100)",
    section: "advanced",
    tooltip:
      "Conversion factor between pedal torque and human-power/assistance figures - the calibrated equivalent of Torque ADC step, used only with Torque sensor advanced and Torque sensor calibrated both enabled. Range 0-255, default 34. Don't use this to change assistance-level amplification - use Torque ADC range trim for that.",
    dependsOn: (v) => v.torqueSensorAdvOnStart === true && v.torqueCalibration === true,
  },
  adcStepEstimated: {
    label: "Torque sensor ADC step estimated",
    section: "advanced",
    tooltip:
      "Estimates Torque ADC step advanced for a 24kg reference weight instead of requiring a real weight calibration. Less accurate, but usable once Torque sensor calibrated is enabled and Torque ADC offset/max are set. Changing this may require re-tuning the Power-assist-mode level percentages.",
    dependsOn: (v) => v.torqueCalibration === true,
  },
  torqueCalibration: {
    label: "Torque sensor calibrated",
    section: "advanced",
    tooltip:
      "Enables using the entered Torque ADC offset/max calibration values. Only enable after entering real calibration values from the display's calibration procedure - enabling with wrong/default values can cause unpredictable behavior.",
  },
};
