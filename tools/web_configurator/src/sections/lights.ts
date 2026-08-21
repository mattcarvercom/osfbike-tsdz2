// Lights section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
import type { FieldValues } from "../ini-import.ts";
// Codes verified against src/ebike_app.c's lights-configuration switch
// (~line 2079) and its trailing comment block documenting all 9 behaviors.
// "Switched on" below means the lights are toggled on via the lights button
// (ui8_lights_state, ~line 2939) - not this page's "Lights enabled" checkbox,
// which is a separate master switch for whether the lights feature exists at
// all. Worded this way deliberately, to avoid reusing "enabled" for both.
const LIGHTS_BEHAVIOR_OPTIONS: { label: string; value: number }[] = [
  { label: "0 - On when lights switched on", value: 0 },
  { label: "1 - Flashing when lights switched on", value: 1 },
  { label: "2 - On when switched on; brake-flashing when braking", value: 2 },
  { label: "3 - Flashing when switched on; on when braking", value: 3 },
  { label: "4 - Flashing when switched on; brake-flashing when braking", value: 4 },
  { label: "5 - On when switched on; always on when braking (even with lights off)", value: 5 },
  { label: "6 - On when switched on; always brake-flashing when braking (even with lights off)", value: 6 },
  { label: "7 - Flashing when switched on; always on when braking (even with lights off)", value: 7 },
  { label: "8 - Flashing when switched on; always brake-flashing when braking (even with lights off)", value: 8 },
];

export const LIGHTS_CONFIGURATION_ON_STARTUP: IntSelectControl = {
  kind: "intSelect",
  key: "lightsConfigurationOnStartup",
  label: "Lights configuration on power-on",
  section: "lights",
  tooltip:
    "Which lights behavior (codes described below) is active as soon as the bike powers on. Each code's \"switched on\" refers to actually toggling the lights on with the lights button, not this page's Lights enabled checkbox above (that's a separate master switch for whether the lights feature exists at all). While riding, this can be swapped for a different behavior using Lights configuration 1/2/3 below - three independent on/off toggles you flip from the display, each one restoring this startup behavior when switched back off.",
  options: LIGHTS_BEHAVIOR_OPTIONS,
  dependsOn: (v) => v.lightsEnabled === true,
  fullWidth: true,
};

// DZ40 has no lights-button menu to reach the SET PARAMETER screen these
// three toggles depend on at all (confirmed against the DZ40 manual's own
// key definitions - its only long-press UP-button action is a plain,
// immediate headlight on/off, and its one settings menu, entered by holding
// M at power-on, is explicitly limited to unit/wheel-diameter/speed-limit/
// battery-voltage) - same root cause as Riding modes' Street/Offroad toggle
// and Assist mode on startup (sections/riding-modes.ts's dz40OffroadDead/
// dz40StreetDead, control-types.ts's dz40AssistFamilyDead), just found later.
// ui8_lights_configuration never leaves LIGHTS_CONFIGURATION_ON_STARTUP on
// that hardware, so these three are permanently dead weight for DZ40, not
// just impractical - config-h-generator.ts also emits
// LIGHTS_CONFIGURATION_ON_STARTUP's own value for all three on DZ40 builds,
// regardless of what's set here, so a stale/misleading number never ships.
const dz40LightsConfigDead = (v: FieldValues) => v.displayTypeDZ40 === true;

export const LIGHTS_CONFIGURATION_1: IntSelectControl = {
  kind: "intSelect",
  key: "lightsConfiguration1",
  label: "Lights configuration 1",
  section: "lights",
  tooltip:
    "\"Lights mode 1\" is an on/off toggle you flip from the display: at assist level TURBO, press the lights button on/off twice (display code E02) to swap the active lights behavior between this preset and Lights configuration on power-on above, then press the same sequence again to swap back. ('Set parameter' must be enabled first, at level OFF - see that field's tooltip for the button sequence.) Braking behaviors (2-8) need brake sensors installed; without them only 0/1 are valid here, so this toggle can instead be repurposed - handing the same E02 button sequence to an unrelated feature instead of a lights behavior. Pick option 11 below to repurpose it as an on/off toggle for Startup assist enabled. There's no true \"off\" for this toggle - E02 always does something. To make it a no-op, set the same code here as Lights configuration on power-on; pressing E02 will then have no visible effect (this also applies to Lights configuration 2/3 below, each against their own E03/E04 press).",
  options: [
    ...LIGHTS_BEHAVIOR_OPTIONS,
    { label: "11 - Repurposed: toggles Startup assist enabled (no brake sensors)", value: 11 },
  ],
  dependsOn: (v) => v.lightsEnabled === true && !dz40LightsConfigDead(v),
};

export const LIGHTS_CONFIGURATION_2: IntSelectControl = {
  kind: "intSelect",
  key: "lightsConfiguration2",
  label: "Lights configuration 2",
  section: "lights",
  tooltip:
    '"Lights mode 2" - the same on/off display toggle as Lights configuration 1 above, but at display code E03 (same button sequence, one step further in the E02/E03/E04 sequence). Without brake sensors, this slot can instead be repurposed to toggle Assist without pedal rotation on/off (option 9 below) - the firmware\'s default choice for this slot.',
  options: [
    ...LIGHTS_BEHAVIOR_OPTIONS,
    { label: "9 - Repurposed: toggles Assist without pedal rotation (no brake sensors)", value: 9 },
  ],
  dependsOn: (v) => v.lightsEnabled === true && !dz40LightsConfigDead(v),
};

export const LIGHTS_CONFIGURATION_3: IntSelectControl = {
  kind: "intSelect",
  key: "lightsConfiguration3",
  label: "Lights configuration 3",
  section: "lights",
  tooltip:
    "\"Lights mode 3\" - the same on/off display toggle as Lights configuration 1 above, but at display code E04. Can instead be repurposed to toggle assistance despite a sensor error at runtime (option 10 below) - the firmware's default choice for this slot, useful as a limp-home option if a torque/cadence/speed sensor fails mid-ride. Unlike the other repurposed toggles, whether that runtime override is actually on or off can't be set here - it always starts disabled at power-on and can only be switched from the display (E04) itself.",
  options: [
    ...LIGHTS_BEHAVIOR_OPTIONS,
    { label: "10 - Repurposed: toggles assist-despite-sensor-error (display-only)", value: 10 },
  ],
  dependsOn: (v) => v.lightsEnabled === true && !dz40LightsConfigDead(v),
};

export const radioControls: RadioControl[] = [];
export const intSelectControls: IntSelectControl[] = [
  LIGHTS_CONFIGURATION_ON_STARTUP,
  LIGHTS_CONFIGURATION_1,
  LIGHTS_CONFIGURATION_2,
  LIGHTS_CONFIGURATION_3,
];

export const fields: Record<string, ExplicitFieldMeta> = {
  lightsEnabled: {
    label: "Lights enabled",
    section: "lights",
    tooltip: "Enables use of the lights, switched on/off via the lights button. Disable if no lights are installed.",
  },
};
