// Startup boost & smooth start section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { radio, type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
export const BOOST_AT_ZERO: RadioControl = radio(
  "Startup boost at zero",
  "startup-boost",
  ["boostAtZeroCadence", "boostAtZeroSpeed", "boostAtZeroAuto"],
  [
    { label: "Cadence", values: { boostAtZeroCadence: true, boostAtZeroSpeed: false, boostAtZeroAuto: false } },
    { label: "Speed", values: { boostAtZeroCadence: false, boostAtZeroSpeed: true, boostAtZeroAuto: false } },
    { label: "Auto", values: { boostAtZeroCadence: false, boostAtZeroSpeed: false, boostAtZeroAuto: true } },
  ],
  "When the startup boost can kick in (only matters when the boost feature itself is on). Cadence: from a standstill and when resuming pedaling in motion. Speed: only from a standstill - recommended for coaster-brake motors. Auto: like Cadence, but with an intervention threshold once the bike is already moving.",
);

export const radioControls: RadioControl[] = [BOOST_AT_ZERO];
export const intSelectControls: IntSelectControl[] = [];

export const fields: Record<string, ExplicitFieldMeta> = {
  startupBoostTorqueFactor: {
    label: "Startup boost torque factor",
    section: "startup-boost",
    tooltip:
      "Percentage increase in torque applied at cadence 0 when the startup boost is active (Power assist mode only). Decreases toward 0 as cadence rises, per Startup boost cadence step below. Recommended 250, maximum 500 - too high stresses the transmission.",
  },
  startupBoostCadenceStep: {
    label: "Startup boost cadence step",
    section: "startup-boost",
    tooltip:
      "How quickly the startup boost torque factor decays as cadence increases. Recommended 25; range 10-50 - a higher value means a shorter-lived boost.",
  },
  startupBoostOnStart: {
    label: "Startup boost enabled at power-on",
    section: "startup-boost",
    tooltip:
      "Whether the startup boost function (extra torque at low cadence, Power assist mode) is active at power on. Also toggleable from some displays. Combining this with Assist without pedal rotation compounds the effect and can stress the transmission.",
  },
  startupAssistEnabled: {
    label: "Startup assist enabled",
    section: "startup-boost",
    tooltip:
      "A separate boost mode that reuses the walk-assist button as its trigger, but only when the lights are ON (lights OFF gives you Walk assist on the same button instead) - not a variant of Walk assist itself. Unlike Walk assist, it does nothing by itself: it only ramps up battery current while you're actively pedaling (e.g. getting moving from a stop or up a steep climb), and has no effect at all in Cadence assist mode. Speed follows the current STREET/OFFROAD limit. Trade-off: enabling this claims the button whenever the lights are on, so plain Walk assist only works with the lights off - inconvenient if you also ride with lights on at night. Firmware checks this before any Cruise-control-override toggle (Walk assist & cruise control page) too - if one of those is also configured for the current assist level, it's claimed the same way and only engages with the lights off.",
    safetyWarning: (v) => {
      const anyOverride =
        v.cruiseOverrideEco === true ||
        v.cruiseOverrideTour === true ||
        v.cruiseOverrideSport === true ||
        v.cruiseOverrideTurbo === true;
      if (v.startupAssistEnabled !== true || !anyOverride) return null;
      return 'Safety: at least one "Override Walk assist ... with Cruise control" toggle (Walk assist & cruise control page) is also on. Firmware checks Startup assist before that override on every walk-assist-button press, so whenever the lights are on, this claims the button first and the override never engages at all - silently, with no error or indication on the display. That defeats the override entirely if you rely on it as a hands/feet-off "get home" mode without pedaling (Startup assist does nothing without active pedaling of its own) - either turn the lights off before relying on the override, or turn this off if the override needs to always be available regardless of lights state.';
    },
  },
  smoothStartEnabled: {
    label: "Smooth start enabled",
    section: "startup-boost",
    // apply_smooth_start() (src/ebike_app.c) isn't level-gated at all - it's
    // a purely time-based ramp keyed off "just started pedaling from a dead
    // stop" (cadence and motor speed both 0), scaling the same percentage
    // regardless of which assist level is selected (ECO/TOUR/SPORT/TURBO
    // etc). It just happens to be more noticeable at higher levels, since
    // the un-ramped jolt it's smoothing is bigger there too - not because
    // the ramp itself changes. Confirmed which riding modes actually call it
    // (torque/cadence/hybrid, not power/eMTB), and that Cadence mode's own
    // call has no SMOOTH_START_ENABLED guard around it, unlike Torque/Hybrid's.
    tooltip:
      "Ramps up the motor's response over the first moment of pedaling from a dead stop (cadence and motor speed both 0), instead of delivering full assist immediately - not a per-level setting: it scales by the same percentage at every assist level, but the jolt it's smoothing is bigger at higher levels, so it's more noticeable there. Only applies in Torque, Cadence, and Hybrid assist modes - no effect in Power assist or eMTB assist mode. Always on in Cadence mode regardless of this checkbox (this only controls Torque and Hybrid modes); see Smooth start ramp below for how gradual the ramp is.",
  },
  smoothStartRamp: {
    label: "Smooth start ramp (%)",
    section: "startup-boost",
    tooltip: "0% = slowest/gentlest start (max ramp), 100% = fastest start (min ramp). Capped at 35% in Cadence mode.",
    sliderRange: { min: 0, max: 100 },
  },
  // No sliderRange despite looking like the other 0-100 percent fields -
  // unlike those, its sane range genuinely flips with Assist level 5 mode
  // (must stay under 100 in Before Eco, over 100 in After Turbo - see
  // ASSIST_LEVEL_5_MODE's own tooltip), so a single fixed slider bound would
  // be actively wrong for one of the two modes rather than just imprecise.
};
