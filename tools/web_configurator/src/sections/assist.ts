// Assist levels section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import {
  radio,
  motorVoltageOf,
  dz40AssistFamilyDead,
  type ExplicitFieldMeta,
  type RadioControl,
  type IntSelectControl,
} from "../control-types.ts";
/**
 * Power assist is the odd one out among the 4 assist-type families: unlike
 * Torque/Cadence/eMTB (whose config.h value goes straight into the firmware's
 * uint8_t array untouched, so 0-254/255 really is the field's whole range),
 * Power assist's value gets HALVED first - see src/main.h:
 * `POWER_ASSIST_LEVEL_ECO (uint8_t)(POWER_ASSIST_LEVEL_1 / 2)` (and TOUR/
 * SPORT/TURBO the same way for levels 2-4). apply_power_assist() then reads
 * that halved value as `ui8_power_assist_multiplier_x50` and divides by 50
 * for the real multiplier - so half of what's typed here IS the x50-encoded
 * byte, and the value typed here is literally the percentage of pedal power
 * added (100 = matches your own pedal power, i.e. doubles total output).
 * Confirmed against the shipped src/config.h default itself:
 * POWER_ASSIST_LEVEL_4 is 480, already well above a plain 0-255 cap - this
 * field's real ceiling is 511 (510/2 and 511/2 both truncate down to the
 * array's true max of 255), not 255. See POWER_ASSIST_LEVEL_FIELDS (ui-model.ts)
 * for where that 511 gets applied to rawMax, and its own comment for why 512+
 * is dangerous, not just "too high".
 */
const POWER_ASSIST_TOOLTIP =
  "Percentage of pedal power added by the motor - 100 means the motor matches your own pedal power (doubles total output), 300 means it adds 3x. Also used at high cadence in Hybrid mode. Confirmed against src/main.h: this value is halved into a uint8_t before storage (POWER_ASSIST_LEVEL_ECO = POWER_ASSIST_LEVEL_1 / 2), so up to 511 is safe - 510 and 511 both truncate down to that byte's own max. Going to 512 or higher wraps the uint8_t cast back to 0, silently turning that level's assist fully OFF instead of capping it at max boost - keep every level at or under 511.";

// Moved here from the now-removed "Power-on defaults" page - it's about
// which assist mode this page's own level fields are seeded from at power
// on, so it reads better at the top of this page than off on its own,
// separate page shared with two unrelated fields. First in radioControls
// (not just placed first in this file) is what actually puts it at the top
// of the page - every EXPLICIT_GROUPS radio floats to the front of its
// section in array order (see ui-model.ts's buildControls()).
export const ASSIST_MODE_ON_STARTUP: RadioControl = radio(
  "Assist mode on power-on",
  "assist",
  ["assistStartupPower", "assistStartupTorque", "assistStartupCadence", "assistStartupEmtb", "assistStartupHybrid"],
  [
    {
      label: "Power",
      values: {
        assistStartupPower: true,
        assistStartupTorque: false,
        assistStartupCadence: false,
        assistStartupEmtb: false,
        assistStartupHybrid: false,
      },
    },
    {
      label: "Torque",
      values: {
        assistStartupPower: false,
        assistStartupTorque: true,
        assistStartupCadence: false,
        assistStartupEmtb: false,
        assistStartupHybrid: false,
      },
    },
    {
      label: "Cadence",
      values: {
        assistStartupPower: false,
        assistStartupTorque: false,
        assistStartupCadence: true,
        assistStartupEmtb: false,
        assistStartupHybrid: false,
      },
    },
    {
      label: "eMTB",
      values: {
        assistStartupPower: false,
        assistStartupTorque: false,
        assistStartupCadence: false,
        assistStartupEmtb: true,
        assistStartupHybrid: false,
      },
    },
    {
      label: "Hybrid",
      values: {
        assistStartupPower: false,
        assistStartupTorque: false,
        assistStartupCadence: false,
        assistStartupEmtb: false,
        assistStartupHybrid: true,
      },
    },
  ],
  "Assist mode active at power on. Hybrid combines Torque (at low cadence) and Power (at high cadence) using the same level parameters as those two modes. Cruise can't be set as the power-on mode - it's only reachable from some displays.",
);

export const EMTB_BASED_ON: RadioControl = radio(
  "eMTB assist based on",
  "assist",
  ["eMtbPower", "eMtbTorque"],
  [
    { label: "Power", values: { eMtbPower: true, eMtbTorque: false } },
    { label: "Torque", values: { eMtbPower: false, eMtbTorque: true } },
  ],
  "Shapes eMTB assist's own curve as cadence changes - separate from Torque modes based on above, which is a different Current/Power axis that also applies to eMTB assist on top of whatever this picks. Power: progressive - the curve eases in more as pedal cadence rises. Torque: fixed curve, not cadence-scaled, matching older firmware versions.",
  // Only ever matters while eMTB assist is the active mode - on DZ40 that
  // means only while eMTB is also the power-on default (same dead-family
  // logic as the eMTB assist level card itself, see dz40AssistFamilyDead's
  // doc comment). Every other display keeps this always-editable, same as
  // every other field on this page, since they can switch into eMTB mode
  // live regardless of what's set as the power-on default.
  (v) => !dz40AssistFamilyDead(v, "eMTB assist level"),
);

export const TORQUE_MODES_BASED_ON: RadioControl = radio(
  "Torque modes based on",
  "assist",
  ["torqueModesBasedOnPower"],
  [
    { label: "Current", values: { torqueModesBasedOnPower: false } },
    { label: "Power", values: { torqueModesBasedOnPower: true } },
  ],
  "How Torque/eMTB/Hybrid assist's calculated current target is scaled for battery voltage - unrelated to eMTB assist based on below (that shapes eMTB's own curve; this scaling step applies afterward, to all three modes alike). Current: current-based, like earlier firmware - for the same pedal torque and level, output power varies with battery voltage, and comparisons against Power mode are skewed. Power: power-based, using the fixed reference voltage set below, so levels compare consistently with Power mode and don't drift as the battery discharges. Recommended for new setups.",
);

export const ASSIST_LEVEL_5_MODE: IntSelectControl = {
  kind: "intSelect",
  key: "assistLevel5Mode",
  label: "Assist level 5 mode",
  section: "assist",
  tooltip:
    "Adds a 5th assist level for displays that support it. Disabled: for 4-level displays. Before Eco: 5th level sits before ECO (e.g. DZ41) - its percentage must be under 100, and levels 2-5 need their percentages set. After Turbo: 5th level sits after TURBO (e.g. EKD01) - its percentage must be over 100, and levels 1-4 need theirs set.",
  options: [
    { label: "Disabled", value: 0 },
    { label: "Before Eco", value: 1 },
    { label: "After Turbo", value: 2 },
  ],
};

export const radioControls: RadioControl[] = [ASSIST_MODE_ON_STARTUP, EMTB_BASED_ON, TORQUE_MODES_BASED_ON];
export const intSelectControls: IntSelectControl[] = [ASSIST_LEVEL_5_MODE];

export const fields: Record<string, ExplicitFieldMeta> = {
  assistWithoutPedalRotationThreshold: {
    label: "Assist-without-pedaling threshold",
    section: "assist",
    tooltip:
      "Sensitivity for starting assistance without turning the pedals. Start low and increase gradually; 100% applies with just a minimum push on the pedals. Recommended 10-30.",
    dependsOn: (v) => v.assistWithoutPedalRotation === true,
    sliderRange: { min: 0, max: 100 },
  },
  assistWithoutPedalRotation: {
    label: "Assist without pedal rotation",
    section: "assist",
    tooltip:
      "Starts assistance from just pushing on the pedals, without turning them - like a hand-bike. Also toggleable from some displays (as an alternative to Lights mode 2). Recommended with brake sensors installed and enabled; setting Torque ADC offset trim (Advanced torque calibration page) to a negative value disables this feature as a safety interlock.",
  },
  powerAssist1: {
    label: "Power assist level 1 (ECO)",
    section: "assist",
    tooltip: POWER_ASSIST_TOOLTIP,
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Power assist level"),
  },
  powerAssist2: {
    label: "Power assist level 2 (TOUR)",
    section: "assist",
    tooltip: POWER_ASSIST_TOOLTIP,
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Power assist level"),
  },
  powerAssist3: {
    label: "Power assist level 3 (SPORT)",
    section: "assist",
    tooltip: POWER_ASSIST_TOOLTIP,
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Power assist level"),
  },
  powerAssist4: {
    label: "Power assist level 4 (TURBO)",
    section: "assist",
    tooltip: POWER_ASSIST_TOOLTIP,
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Power assist level"),
  },
  torqueAssist1: {
    label: "Torque assist level 1 (ECO)",
    section: "assist",
    tooltip: "Relative value proportional to pedal torque, max 255. Also used at low cadence in Hybrid mode.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Torque assist level"),
  },
  torqueAssist2: {
    label: "Torque assist level 2 (TOUR)",
    section: "assist",
    tooltip: "Relative value proportional to pedal torque, max 255. Also used at low cadence in Hybrid mode.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Torque assist level"),
  },
  torqueAssist3: {
    label: "Torque assist level 3 (SPORT)",
    section: "assist",
    tooltip: "Relative value proportional to pedal torque, max 255. Also used at low cadence in Hybrid mode.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Torque assist level"),
  },
  torqueAssist4: {
    label: "Torque assist level 4 (TURBO)",
    section: "assist",
    tooltip: "Relative value proportional to pedal torque, max 255. Also used at low cadence in Hybrid mode.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Torque assist level"),
  },
  cadenceAssist1: {
    label: "Cadence assist level 1 (ECO)",
    section: "assist",
    tooltip:
      "Roughly doubles into Watts once combined with pedaling cadence (this value plus cadence RPM, summed, then x2) - e.g. 50 gives 102W at cadence 1 RPM, 220W at cadence 60 RPM, so real power scales well past this field's own value. Max raw value 255. Still capped by the Offroad-mode/Street-mode power limit (whichever is active) and Battery current max. Recommended with brake sensors installed and enabled.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Cadence assist level"),
  },
  cadenceAssist2: {
    label: "Cadence assist level 2 (TOUR)",
    section: "assist",
    tooltip:
      "Roughly doubles into Watts once combined with pedaling cadence (this value plus cadence RPM, summed, then x2) - e.g. 50 gives 102W at cadence 1 RPM, 220W at cadence 60 RPM, so real power scales well past this field's own value. Max raw value 255. Still capped by the Offroad-mode/Street-mode power limit (whichever is active) and Battery current max. Recommended with brake sensors installed and enabled.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Cadence assist level"),
  },
  cadenceAssist3: {
    label: "Cadence assist level 3 (SPORT)",
    section: "assist",
    tooltip:
      "Roughly doubles into Watts once combined with pedaling cadence (this value plus cadence RPM, summed, then x2) - e.g. 50 gives 102W at cadence 1 RPM, 220W at cadence 60 RPM, so real power scales well past this field's own value. Max raw value 255. Still capped by the Offroad-mode/Street-mode power limit (whichever is active) and Battery current max. Recommended with brake sensors installed and enabled.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Cadence assist level"),
  },
  cadenceAssist4: {
    label: "Cadence assist level 4 (TURBO)",
    section: "assist",
    tooltip:
      "Roughly doubles into Watts once combined with pedaling cadence (this value plus cadence RPM, summed, then x2) - e.g. 50 gives 102W at cadence 1 RPM, 220W at cadence 60 RPM, so real power scales well past this field's own value. Max raw value 255. Still capped by the Offroad-mode/Street-mode power limit (whichever is active) and Battery current max. Recommended with brake sensors installed and enabled.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "Cadence assist level"),
  },
  emtbAssist1: {
    label: "eMTB assist level 1 (ECO)",
    section: "assist",
    tooltip: "Relative value, max 255 - higher values reach max motor power faster/more reactively.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "eMTB assist level"),
  },
  emtbAssist2: {
    label: "eMTB assist level 2 (TOUR)",
    section: "assist",
    tooltip: "Relative value, max 255 - higher values reach max motor power faster/more reactively.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "eMTB assist level"),
  },
  emtbAssist3: {
    label: "eMTB assist level 3 (SPORT)",
    section: "assist",
    tooltip: "Relative value, max 255 - higher values reach max motor power faster/more reactively.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "eMTB assist level"),
  },
  emtbAssist4: {
    label: "eMTB assist level 4 (TURBO)",
    section: "assist",
    tooltip: "Relative value, max 255 - higher values reach max motor power faster/more reactively.",
    dependsOn: (v) => !dz40AssistFamilyDead(v, "eMTB assist level"),
  },
  assistLevel5Percent: {
    label: "Assist level 5 percent",
    section: "assist",
    tooltip:
      "The 5th assist level's percentage - relative to ECO (Before Eco mode, must be under 100) or TURBO (After Turbo mode, must be over 100). The real level-5 value is (that reference level's own value) x (this percent / 100), not this value directly - confirmed against src/ebike_app.c, e.g. line 1264: ui8_riding_mode_parameter = (uint8_t)((ui8_riding_mode_parameter * ASSIST_LEVEL_5_PERCENT) / 100). Example: Before Eco mode, with ECO set to 150 and this field set to 50, level 5 works out to 150 x 50% = 75. Careful in After Turbo mode: that result is cast straight back into the same uint8_t (0-255) every other assist level uses, with no clamping - if TURBO x (percent/100) goes over 255 it silently wraps around modulo 256 instead of capping at 255, giving a level 5 far weaker than intended instead of the boost you wanted. Example: TURBO 200 with this field at 150 computes 200 x 150% = 300, which wraps to 300 - 256 = 44, not 255. Keep TURBO x (percent/100) at or under 255. Power assist is the one exception to \"that reference level's own value\": its ECO/TURBO fields are halved before storage (see their own tooltip), so it's half of what's shown in the Power assist level fields that actually gets multiplied here - e.g. Power TURBO showing 480 means 240 is the value this percent applies to, computed and shown for you in the badge next to this field and above the Power assist level chart.",
    dependsOn: (v) => v.assistLevel5Mode !== 0,
  },
  torqueModesRefVolt: {
    label: "Torque-based-on-power reference voltage (V)",
    section: "assist",
    required: true,
    tooltip:
      "Reference voltage used for power-based Torque/eMTB/Hybrid assist (see Torque modes based on above): the calculated current target is scaled by this value divided by the live battery voltage, so it should normally just be your nominal battery voltage - e.g. 36 for a 36V pack, 48 for 48V. Default 36 regardless of your actual hardware - this doesn't auto-follow Motor type, so it's easy to leave stale after picking a different voltage class. Only matters when Torque modes based on is set to Power.",
    dependsOn: (v) => v.torqueModesBasedOnPower === true,
    hint: (v) => {
      const motor = motorVoltageOf(v);
      const ref = v.torqueModesRefVolt;
      return v.torqueModesBasedOnPower === true && motor !== null && typeof ref === "number" && ref !== motor
        ? `Motor type (Motor page) is ${motor}V, but this is set to ${ref}V - make sure that's intentional, not a leftover default.`
        : null;
    },
  },
};
