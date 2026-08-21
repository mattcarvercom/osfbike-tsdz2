// Riding modes section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { radio, type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
import type { FieldValues } from "../ini-import.ts";

// Moved here from the now-removed "Power-on defaults" page, at the top of
// this page (first in radioControls - see ui-model.ts's buildControls() for
// why array order puts it there) since it's the thing that decides which of
// this page's own Offroad/Street cards is the one actually active at power
// on. DZ40's bespoke render (render/riding-modes-page.ts's
// renderRidingModesDZ40) already reads state.values.streetModeOnStart
// directly to badge the right card - it also renders this control itself,
// explicitly, since its own generic groupSectionControls() path (used by
// every other display type) is bypassed entirely for DZ40 and would
// otherwise silently drop it.
export const STREET_MODE_ON_STARTUP: RadioControl = radio(
  "Riding mode on power-on",
  "riding-modes",
  ["streetModeOnStart"],
  [
    { label: "Street-mode", values: { streetModeOnStart: true } },
    { label: "Offroad-mode", values: { streetModeOnStart: false } },
  ],
  "Which riding mode is active at power on. Also toggleable from some displays at any time - the speed/power limits in this section apply whenever STREET mode is active, regardless of this default.",
);

export const radioControls: RadioControl[] = [STREET_MODE_ON_STARTUP];
export const intSelectControls: IntSelectControl[] = [];

/**
 * DZ40 has no lights-button menu to switch riding modes while riding (see
 * the DZ40 user manual - its only mode-select path is this same page's own
 * "Riding mode on power-on" setting, above) - so for DZ40, whichever
 * mode ISN'T that startup default never actually runs, unlike every other
 * supported display, which really can toggle it live and treats the startup
 * setting as just an initial default. render/riding-modes-page.ts frames
 * these two fields and the four below into titled/badged cards for DZ40
 * specifically (see renderSectionPage's own DZ40 check) and shows one
 * consolidated note at the top of whichever card is dead, instead of
 * repeating the same explanation on every field inside it - this is only the
 * disabling half of that (dependsOn), the explanatory text lives with the
 * card itself.
 */
function dz40OffroadDead(v: FieldValues): boolean {
  return v.displayTypeDZ40 === true && v.streetModeOnStart === true;
}
function dz40StreetDead(v: FieldValues): boolean {
  return v.displayTypeDZ40 === true && v.streetModeOnStart !== true;
}

export const fields: Record<string, ExplicitFieldMeta> = {
  targetMaxBatteryPower: {
    label: "Offroad-mode power limit (W)",
    section: "riding-modes",
    required: true,
    tooltip:
      "Motor power limit in OFFROAD mode - the counterpart to Street-mode power limit, applied instead whenever Street mode is off. Must stay under what the battery can really deliver - the effective current limit is whichever is lower: this divided by battery voltage, or Battery current max.",
    dependsOn: (v) => !dz40OffroadDead(v),
  },
  wheelMaxSpeed: {
    label: "Offroad-mode speed limit",
    section: "riding-modes",
    speedField: "kmh",
    tooltip:
      "Speed limit in OFFROAD mode - the counterpart to Street-mode speed limit, applied instead whenever Street mode is off. Power tapers off as the bike approaches it. Always stored in km/h internally; shown/entered in mph here to match the Speed units setting, same as the Java tool. Ignored (replaced by the display's own limit) when Max speed read from display is enabled.",
    dependsOn: (v) => v.maxSpeedFromDisplay !== true && !dz40OffroadDead(v),
    // Confirmed against src/ebike_app.c (uart_receive_package(), the
    // #if ENABLE_WHEEL_MAX_SPEED_FROM_DISPLAY block): the configured value
    // is fully overwritten with the display's own reading every time a
    // wheel-size packet arrives - not just compared and clamped like Street-
    // mode's own field below - so this one really is dead weight, not just
    // an occasional override.
    hint: (v) =>
      v.maxSpeedFromDisplay === true
        ? 'Disabled: "Max speed read from display" (Display page) is on - this value is completely overwritten by the display\'s own reading, not just compared against it, so whatever you set here never takes effect.'
        : null,
  },
  streetModePowerLimit: {
    label: "Street-mode power limit (W)",
    section: "riding-modes",
    required: true,
    tooltip:
      "Motor power limit applied when STREET mode is active - the counterpart to Offroad-mode power limit, applied instead of it whenever Street mode is on. Always in effect while Street mode is on - confirmed against src/ebike_app.c: there is no firmware-side way to disable it. Same caveat applies: must stay under what the battery can really deliver - the effective current limit is whichever is lower: this divided by battery voltage, or Battery current max. Default 500W, typically well under Offroad-mode's limit to match street legal restrictions (e.g. 250W in the EU).",
    dependsOn: (v) => !dz40StreetDead(v),
  },
  streetModeSpeedLimit: {
    label: "Street-mode speed limit",
    section: "riding-modes",
    speedField: "kmh",
    tooltip:
      "Speed limit applied when STREET mode is active - the counterpart to Offroad-mode speed limit above, applied instead whenever Street mode is off. Power tapers off as the bike approaches it. Always stored in km/h internally; shown/entered in mph here to match the Speed units setting, same as the Java tool. Overridden by the display's own limit when Max speed read from display is enabled (whichever is lower wins).",
    dependsOn: (v) => !dz40StreetDead(v),
    // Not disabled like Offroad-mode speed limit above - confirmed against
    // src/ebike_app.c: the display's reading only ever clamps this value
    // DOWN if this one is currently the higher of the two, and leaves it
    // alone otherwise, so it's still the one actually in effect whenever
    // it's already the lower/stricter limit. Informational only.
    hint: (v) =>
      v.maxSpeedFromDisplay === true
        ? "\"Max speed read from display\" (Display page) is on - this value still applies, but gets clamped down to the display's own reading if that ever reads lower than what's set here."
        : null,
  },
  streetCruiseEnabled: {
    label: "Street-mode cruise enabled",
    section: "riding-modes",
    tooltip:
      "Enables Cruise mode while in STREET mode - Cruise control enabled (Walk assist & cruise control page) must ALSO be on, since that's the master switch that compiles the whole cruise feature in at all; this checkbox only extends it into Street mode on top of that; it does nothing by itself. Cruise-without-pedaling is always disabled in STREET mode regardless of that setting. Only available with brake sensors installed and enabled.",
    dependsOn: (v) => v.brakeSensor === true && v.cruiseEnabled === true && !dz40StreetDead(v),
    hint: (v) =>
      v.brakeSensor !== true
        ? "Disabled: needs Optional brake input (Throttle & brake page) set to Brake sensor."
        : v.cruiseEnabled !== true
          ? "Disabled: needs Cruise control enabled (Walk assist & cruise control page) - without it the cruise feature isn't compiled into the firmware at all, so this checkbox alone has no effect."
          : null,
  },
  streetWalkEnabled: {
    label: "Street-mode walk assist enabled",
    section: "riding-modes",
    tooltip:
      "Enables walk assist while STREET mode is active - Walk assist enabled (Walk assist & cruise control page) must ALSO be on, since that's the master switch that compiles the whole walk-assist feature in at all; this checkbox only extends it into Street mode on top of that; it does nothing by itself. Turns itself off if Walk assist debounce enabled is on.",
    dependsOn: (v) => v.walkTimeEnabled !== true && v.walkAssistEnabled === true && !dz40StreetDead(v),
    hint: (v) =>
      v.walkTimeEnabled === true
        ? "Disabled: Walk assist debounce enabled (Walk assist & cruise control page) takes over walk-assist-button handling instead."
        : v.walkAssistEnabled !== true
          ? "Disabled: needs Walk assist enabled (Walk assist & cruise control page) - without it the walk-assist feature isn't compiled into the firmware at all, so this checkbox alone has no effect."
          : null,
  },
};
