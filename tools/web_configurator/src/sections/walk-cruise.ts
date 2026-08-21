// Walk assist & cruise control section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
/** cruiseThresholdSpeed is always stored/compared in km/h (see speedField's own doc comment) regardless of the Speed units display setting - 1 mile = 1.609344 km. */
const CRUISE_THRESHOLD_INJURY_RISK_KMH = 5 * 1.609344;

export const radioControls: RadioControl[] = [];
export const intSelectControls: IntSelectControl[] = [];

export const fields: Record<string, ExplicitFieldMeta> = {
  walkAssistEnabled: {
    label: "Walk assist enabled",
    section: "walk-cruise",
    tooltip:
      "Enables walk assist (accompanying the bike on foot, up to ~6 km/h) - the master switch that compiles the whole walk-assist feature into the firmware at all; Street-mode walk assist enabled (Riding modes page) is a separate, additional switch that only extends it into Street mode - both need to be on for walk assist to work while in Street mode. Also needs enabling in the display's hidden menu; activated with the dedicated button - see your display's manual. Only covers levels with no Cruise-control override (below) turned on for them: any level with its own override enabled keeps triggering Cruise control on the same button regardless of this setting - the firmware never gates an override on this checkbox, only on Cruise control enabled.",
  },
  walkSpeed1: {
    label: "Walk assist speed 1 (ECO)",
    section: "walk-cruise",
    speedField: "kmhX10",
    tooltip:
      'Units: always km/h x10, no matter what the Speed units setting (Display page) is - divide by 10 to get km/h. Example: 30 means 3.0 km/h (about 1.9 mph). Recommended range: 25-45 (2.5-4.5 km/h, about 1.6-2.8 mph) - try low values first. Has no effect while "Override Walk assist ECO with Cruise control" (Walk assist & cruise control page) is on - Cruise control takes over ECO\'s walk-assist-button behavior entirely.',
    // See walkSpeed3's comment below for why this isn't combined with
    // cruiseOverrideEco directly - same reasoning applies to every level.
    dependsOn: (v) => v.walkAssistEnabled === true,
  },
  walkSpeed2: {
    label: "Walk assist speed 2 (TOUR)",
    section: "walk-cruise",
    speedField: "kmhX10",
    tooltip:
      'Units: always km/h x10, no matter what the Speed units setting (Display page) is - divide by 10 to get km/h. Example: 30 means 3.0 km/h (about 1.9 mph). Recommended range: 25-45 (2.5-4.5 km/h, about 1.6-2.8 mph) - try low values first. Has no effect while "Override Walk assist TOUR with Cruise control" (Walk assist & cruise control page) is on - Cruise control takes over TOUR\'s walk-assist-button behavior entirely.',
    dependsOn: (v) => v.walkAssistEnabled === true,
  },
  walkSpeed3: {
    label: "Walk assist speed 3 (SPORT)",
    section: "walk-cruise",
    speedField: "kmhX10",
    tooltip:
      'Units: always km/h x10, no matter what the Speed units setting (Display page) is - divide by 10 to get km/h. Example: 30 means 3.0 km/h (about 1.9 mph). Recommended range: 25-45 (2.5-4.5 km/h, about 1.6-2.8 mph) - try low values first. Has no effect while "Override Walk assist SPORT with Cruise control" (Walk assist & cruise control page) is on - Cruise control takes over SPORT\'s walk-assist-button behavior entirely.',
    // Deliberately NOT combined with cruiseOverrideSport here (or any
    // level's own override, on any of the 4 walkSpeedN fields) - dependsOn's
    // source text is also this family's grouping identity (see
    // dependsOnKey() in render/control-group.ts), so a per-level difference here would
    // split "Walk assist speed" into separate cards instead of one 4-cell
    // one. The override's extra greying-out is applied later, per cell, in
    // renderControlGroup instead - see EXTRA_CELL_ENABLED.
    dependsOn: (v) => v.walkAssistEnabled === true,
  },
  walkSpeed4: {
    label: "Walk assist speed 4 (TURBO)",
    section: "walk-cruise",
    speedField: "kmhX10",
    tooltip:
      'Units: always km/h x10, no matter what the Speed units setting (Display page) is - divide by 10 to get km/h. Example: 30 means 3.0 km/h (about 1.9 mph). Recommended range: 25-45 (2.5-4.5 km/h, about 1.6-2.8 mph) - try low values first. Has no effect while "Override Walk assist TURBO with Cruise control" (Walk assist & cruise control page) is on - Cruise control takes over TURBO\'s walk-assist-button behavior entirely.',
    dependsOn: (v) => v.walkAssistEnabled === true,
  },
  walkSpeedLimit: {
    label: "Walk assist speed limit",
    section: "walk-cruise",
    speedField: "kmhX10",
    tooltip:
      "Units: always km/h x10, no matter what the Speed units setting (Display page) is - divide by 10 to get km/h. Example: 60 means 6.0 km/h (about 3.7 mph). Maximum walk-assist speed limit - check local legal limits, max is 6.0 km/h (60) in the EU.",
    dependsOn: (v) => v.walkAssistEnabled === true,
  },
  walkTimeEnabled: {
    label: "Walk assist debounce enabled",
    section: "walk-cruise",
    tooltip:
      "Debounces the walk-assist button so a rebound on rough terrain doesn't release it unintentionally. Only available with brake sensors installed and enabled.",
    dependsOn: (v) => v.walkAssistEnabled === true && v.brakeSensor === true,
    hint: (v) =>
      v.walkAssistEnabled === true && v.brakeSensor !== true
        ? "Disabled: needs Optional brake input (Throttle & brake page) set to Brake sensor."
        : null,
  },
  walkAssistTime: {
    label: "Walk assist debounce time (x0.1s)",
    section: "walk-cruise",
    tooltip:
      "Debounce time for the walk-assist button, in units of ~0.1s each - e.g. 3 means ~0.3s, not 3 seconds. This is a plain integer tick count (ui8_walk_assist_debounce_counter in src/ebike_app.c), incremented once per UART packet received from the display rather than by a fixed hardware timer, so ~0.1s is an approximation, not an exact guarantee - confirmed against the Java tool's own tooltip for this field ('Max value 255 (0.1 s)'). Set as low as possible, just above what the button needs to register. Assistance stays active for this long after release - to stop it sooner, change level, or press level 0-OFF.",
    dependsOn: (v) => v.walkAssistEnabled === true && v.walkTimeEnabled === true,
  },
  cruiseSpeed1: {
    label: "Cruise target speed 1 (ECO)",
    section: "walk-cruise",
    speedField: "kmh",
    tooltip:
      "Target speed to maintain, shown/entered in your Speed units setting (km/h or mph, per the field label). Actual speed may fall short if motor power is limited. Defaults: 12/16/20/24 km/h for ECO/TOUR/SPORT/TURBO.",
    dependsOn: (v) => v.cruiseEnabled === true,
  },
  cruiseSpeed2: {
    label: "Cruise target speed 2 (TOUR)",
    section: "walk-cruise",
    speedField: "kmh",
    tooltip:
      "Target speed to maintain, shown/entered in your Speed units setting (km/h or mph, per the field label). Actual speed may fall short if motor power is limited. Defaults: 12/16/20/24 km/h for ECO/TOUR/SPORT/TURBO.",
    dependsOn: (v) => v.cruiseEnabled === true,
  },
  cruiseSpeed3: {
    label: "Cruise target speed 3 (SPORT)",
    section: "walk-cruise",
    speedField: "kmh",
    tooltip:
      "Target speed to maintain, shown/entered in your Speed units setting (km/h or mph, per the field label). Actual speed may fall short if motor power is limited. Defaults: 12/16/20/24 km/h for ECO/TOUR/SPORT/TURBO.",
    dependsOn: (v) => v.cruiseEnabled === true,
  },
  cruiseSpeed4: {
    label: "Cruise target speed 4 (TURBO)",
    section: "walk-cruise",
    speedField: "kmh",
    tooltip:
      "Target speed to maintain, shown/entered in your Speed units setting (km/h or mph, per the field label). Actual speed may fall short if motor power is limited. Defaults: 12/16/20/24 km/h for ECO/TOUR/SPORT/TURBO.",
    dependsOn: (v) => v.cruiseEnabled === true,
  },
  cruiseOverrideEco: {
    label: "Override Walk assist ECO with Cruise control",
    section: "walk-cruise",
    tooltip:
      'Useful for displays with no way to reach Cruise mode at all - e.g. the DZ40, which has no lights button, so it can\'t open the hidden menu that normally selects Cruise mode. This repoints Walk assist ECO\'s own button trigger to engage Cruise control\'s real PID speed-hold instead, targeting "Cruise target speed 1 (ECO)" above - Walk assist speed 1 has no effect once this is on. Works independently of "Walk assist enabled" above - even with that off, this override still engages on the same button; the firmware only requires "Cruise control enabled". Automatically turns on "Cruise without pedaling" so this can hold speed hands/feet-off; you can turn that back off, but then this override needs active pedaling to engage. Every level (ECO/TOUR/SPORT/TURBO) has its own independent override toggle - turn on only the ones you want.',
    // No per-field `hint` here (or on Tour/Sport/Turbo below) - the four
    // toggles share one consolidated live-state warning, rendered once below
    // all of them, instead of each repeating an almost-identical hint. See
    // cruiseOverrideWarning() in render/control-group.ts.
    dependsOn: (v) => v.cruiseEnabled === true,
  },
  cruiseOverrideTour: {
    label: "Override Walk assist TOUR with Cruise control",
    section: "walk-cruise",
    tooltip:
      'Useful for displays with no way to reach Cruise mode at all - e.g. the DZ40, which has no lights button, so it can\'t open the hidden menu that normally selects Cruise mode. This repoints Walk assist TOUR\'s own button trigger to engage Cruise control\'s real PID speed-hold instead, targeting "Cruise target speed 2 (TOUR)" above - Walk assist speed 2 has no effect once this is on. Works independently of "Walk assist enabled" above - even with that off, this override still engages on the same button; the firmware only requires "Cruise control enabled". Automatically turns on "Cruise without pedaling" so this can hold speed hands/feet-off; you can turn that back off, but then this override needs active pedaling to engage.',
    dependsOn: (v) => v.cruiseEnabled === true,
  },
  cruiseOverrideSport: {
    label: "Override Walk assist SPORT with Cruise control",
    section: "walk-cruise",
    tooltip:
      'Useful for displays with no way to reach Cruise mode at all - e.g. the DZ40, which has no lights button, so it can\'t open the hidden menu that normally selects Cruise mode. This repoints Walk assist SPORT\'s own button trigger to engage Cruise control\'s real PID speed-hold instead, targeting "Cruise target speed 3 (SPORT)" above - Walk assist speed 3 has no effect once this is on. Works independently of "Walk assist enabled" above - even with that off, this override still engages on the same button; the firmware only requires "Cruise control enabled". Automatically turns on "Cruise without pedaling" so this can hold speed hands/feet-off; you can turn that back off, but then this override needs active pedaling to engage.',
    dependsOn: (v) => v.cruiseEnabled === true,
  },
  cruiseOverrideTurbo: {
    label: "Override Walk assist TURBO with Cruise control",
    section: "walk-cruise",
    tooltip:
      'Useful for displays with no way to reach Cruise mode at all - e.g. the DZ40, which has no lights button, so it can\'t open the hidden menu that normally selects Cruise mode. This repoints Walk assist TURBO\'s own button trigger to engage Cruise control\'s real PID speed-hold instead, targeting "Cruise target speed 4 (TURBO)" above - Walk assist speed 4 has no effect once this is on. Works independently of "Walk assist enabled" above - even with that off, this override still engages on the same button; the firmware only requires "Cruise control enabled". Automatically turns on "Cruise without pedaling" so this can hold speed hands/feet-off; you can turn that back off, but then this override needs active pedaling to engage.',
    dependsOn: (v) => v.cruiseEnabled === true,
  },
  cruiseWithoutPedaling: {
    label: "Cruise without pedaling",
    section: "walk-cruise",
    tooltip:
      "Off (default): cruise speed is only maintained while pedaling - stop pedaling and the motor stops (like Cadence assist, but changing level changes target speed rather than power). On: hold the walk-assist button to maintain speed without pedaling, like a throttle with stepped speed levels; releasing the button stops the motor. Only available with brake sensors installed and enabled, and never active in STREET mode.",
    dependsOn: (v) => v.cruiseEnabled === true && v.brakeSensor === true,
    hint: (v) =>
      v.cruiseEnabled === true && v.brakeSensor !== true
        ? "Disabled: needs Optional brake input (Throttle & brake page) set to Brake sensor."
        : null,
  },
  cruiseThresholdSpeed: {
    label: "Cruise threshold speed",
    section: "walk-cruise",
    speedField: "kmh",
    tooltip:
      "Minimum speed for cruise mode to engage; below this, Cadence assist is used instead. Shown/entered in your Speed units setting (km/h or mph, per the field label). Default 10 km/h. With this at 0 and Cruise without pedaling enabled, holding walk assist starts the motor from a complete standstill without pedaling - treat as an emergency-only 'get home' mode (e.g. broken freehub), available only in OFFROAD mode. Check local throttle-equivalent legal restrictions.",
    dependsOn: (v) => v.cruiseEnabled === true,
    safetyWarning: (v) => {
      const anyOverride =
        v.cruiseOverrideEco === true ||
        v.cruiseOverrideTour === true ||
        v.cruiseOverrideSport === true ||
        v.cruiseOverrideTurbo === true;
      const threshold = Number(v.cruiseThresholdSpeed ?? 0);
      if (!anyOverride || threshold >= CRUISE_THRESHOLD_INJURY_RISK_KMH) return null;
      return 'Safety: at least one "Override Walk assist ... with Cruise control" toggle (above) is on, and this threshold is under ~5 mph (8 km/h) - low enough that the walk-assist button, held down, can power the motor up to real riding speed with almost no warning, hands/feet-off if "Cruise without pedaling" is also on. That\'s a real, intentional use case at 0: a "get home" limp mode with throttle-like control when pedaling isn\'t possible (lost/damaged pedals, crank arm loss, injury) and no throttle is installed. But it also means anyone who doesn\'t know that button isn\'t just walk-assist anymore - including you in a careless moment, or someone else who borrows or test-rides this bike - could be caught off guard by real motor power and lose control. Only keep it this low if you actually want that capability, and make sure anyone else who might use the bike knows about it.';
    },
  },
  cruiseEnabled: {
    label: "Cruise control enabled",
    section: "walk-cruise",
    tooltip:
      "Enables Cruise control mode - the master switch that compiles the whole cruise feature into the firmware at all; Street-mode cruise enabled (Riding modes page) is a separate, additional switch that only extends it into Street mode - both need to be on for cruise to work while in Street mode. It's only selectable from some displays, not settable as the power-on mode.",
  },
};
