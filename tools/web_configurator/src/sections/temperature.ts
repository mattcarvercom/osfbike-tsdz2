// Temperature section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { radio, type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
export const TEMPERATURE_SENSOR_TYPE: RadioControl = radio(
  "Temperature sensor type",
  "temperature",
  ["temperatureSensorType"],
  [
    { label: "LM35", values: { temperatureSensorType: false } },
    { label: "TMP36", values: { temperatureSensorType: true } },
  ],
  "Which temperature sensor model is installed.",
  (v) => v.optionalAdcTemperature === true,
);

export const radioControls: RadioControl[] = [TEMPERATURE_SENSOR_TYPE];
export const intSelectControls: IntSelectControl[] = [];

export const fields: Record<string, ExplicitFieldMeta> = {
  motorTempMin: {
    label: "Motor temperature min limit (C)",
    section: "temperature",
    tooltip:
      "Motor temperature at which the controller starts limiting power to protect the motor. Range 0-255C, default 65C.",
    dependsOn: (v) => v.optionalAdcTemperature === true,
  },
  motorTempMax: {
    label: "Motor temperature max limit (C)",
    section: "temperature",
    tooltip:
      "Motor temperature at which the controller shuts the motor off entirely. Range 0-255C, default 95C - should be set above Motor temperature min limit.",
    dependsOn: (v) => v.optionalAdcTemperature === true,
  },
  tempErrorMinLimitEnabled: {
    label: "Temperature error at min limit",
    section: "temperature",
    tooltip:
      "If enabled, ERROR_OVERTEMPERATURE (E06) is reported once the min limit is exceeded; if disabled, it's reported at the max limit instead.",
    dependsOn: (v) => v.optionalAdcTemperature === true,
  },
};
