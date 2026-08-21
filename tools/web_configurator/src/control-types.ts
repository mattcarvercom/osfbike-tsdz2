// Control-shape types + the small set of helpers/constants genuinely shared
// across more than one src/sections/*.ts file (motorVoltageOf/batteryVoltageOf
// cross-reference each other's fields from Motor, Battery, and Assist levels;
// CELLS_TO_SYSTEM_VOLTAGE backs both). A helper used by only one section
// (e.g. throttle.ts's bothTemperatureInputsSelected) stays local to that
// file instead of landing here - this file is for real cross-section
// sharing only, not a catch-all.

import type { FieldValues } from "./ini-import.ts";

export interface Section {
  id: string;
  title: string;
  /** Shown as a banner under the page title, above every field - for context that applies to the whole page rather than one field (e.g. "this hardware isn't installed by default"). Absent means no banner. Always shown, unlike dynamicNote below - use this for context that's true regardless of the current form values. */
  note?: string;
  /** Same idea as note, but re-evaluated against live form values on every render and only shown when non-null - for a banner that only applies in certain configurations, not always (e.g. Temperature's brake-switch notice below). Rendered as its own banner under the static note, if both are present. */
  dynamicNote?: (values: FieldValues) => string | null;
}

export const SECTIONS: Section[] = [
  { id: "motor", title: "Motor" },
  { id: "battery", title: "Battery" },
  { id: "display", title: "Display" },
  // Riding modes' two power limits (Offroad/Street) are both capped by what
  // the battery can actually deliver - see targetMaxBatteryPower/
  // streetModePowerLimit's own tooltips in sections/riding-modes.ts, both of
  // which reference Battery current max directly - so this sits close to
  // Battery, not off with Throttle/Walk-cruise where it used to be. Kept as
  // its own page rather than folded into Battery itself, which already has
  // enough of its own fields.
  { id: "riding-modes", title: "Riding modes" },
  {
    id: "lights",
    title: "Lights",
    // Confirmed against the rider's own DZ40-equipped Varstrom kits: no
    // wire/output for a physical light exists in the harness, only the
    // controller's own internal GPIOD4 pin (src/pins.h) driving an
    // unpopulated connector inside the sealed housing. Every field on this
    // page still works and builds fine regardless - this is a hardware
    // caveat, not something any of them can route around.
    dynamicNote: (v) =>
      v.displayTypeDZ40 === true
        ? "Varstrom motor kits paired with a DZ40 display don't come with a wire or output for lights - the controller's lights pin has no connector routed out to the harness. A physical headlight needs custom modification (opening the controller and wiring to it directly) even with Lights enabled turned on below."
        : null,
  },
  { id: "assist", title: "Assist levels" },
  { id: "walk-cruise", title: "Walk assist & cruise control" },
  { id: "throttle", title: "Throttle & brake" },
  { id: "startup-boost", title: "Startup boost & smooth start" },
  {
    id: "temperature",
    title: "Temperature",
    // These fields only ever reach firmware via apply_temperature_limiting()
    // (src/ebike_app.c), which is compiled in only under
    // `#elif (OPTIONAL_ADC_FUNCTION == TEMPERATURE_CONTROL)` - i.e. only for
    // Optional throttle input set to Temperature sensor. Optional brake
    // input's own Temperature sensor option (BRAKE_TEMPERATURE_SWITCH) is a
    // fixed-trip thermostat switch with no min/max/type concept at all (see
    // its own tooltip in sections/throttle.ts and the dynamicNote below) -
    // it used to be worded here as if it unlocked these same fields, which
    // was never true.
    note: "The TSDZ2 platform doesn't come with a temperature sensor installed by default. To use these fields, wire one up and set Optional throttle input (Throttle & brake page) to Temperature sensor - that repurposes the throttle input, so it comes at the cost of not having a throttle.",
    dynamicNote: (v) =>
      v.temperatureSwitch === true && v.optionalAdcTemperature !== true
        ? "Optional brake input (Throttle & brake page) is set to Temperature sensor - that's a fixed-trip thermostat switch, not the graduated sensor these fields calibrate, so there's nothing to configure for it here. It reports ERROR_OVERTEMPERATURE on its own once tripped, at a fixed point built into the switch."
        : null,
  },
  { id: "advanced", title: "Advanced torque calibration" },
  { id: "misc", title: "Miscellaneous" },
];

/** Whether a control should be enabled, given the full current form state. Absent means always enabled. */
export type DependsOn = (values: FieldValues) => boolean;

interface BaseControl {
  label: string;
  section: string;
  tooltip?: string;
  dependsOn?: DependsOn;
  /** Java tool shows this field's label in red - a value the user really must set for their specific hardware, not a tunable default. */
  required?: boolean;
  /** Raw value is always stored in km/h (the "kmhX10" variant is additionally x10-scaled) regardless of the Speed units setting - display/edit it converted to the live unit, matching the Java tool's behavior. Only meaningful on "number" controls. */
  speedField?: "kmh" | "kmhX10";
  /** Purely decorative unit-conversion hint next to the input (see kmhX10's own hint - same idea, just for a plain distance rather than a speed): the raw value's always stored/edited in mm regardless of anything else, this never touches it. Currently only wheelPerimeter uses this - a distinct field from speedField since nothing in this app's Speed units setting governs distance units, unlike speed's km/h-vs-mph toggle. Only meaningful on "number" controls. */
  distanceField?: "mm";
  /** Advisory (not an error) shown under the field when other, unrelated settings mean this one won't have its full documented effect - e.g. PWM frequency 19 kHz not reaching its top cadence without Field weakening also enabled elsewhere. Unlike rangeError (a firmware storage-width violation), nothing here is actually wrong or unbuildable - null means nothing to flag right now. */
  hint?: (values: FieldValues) => string | null;
  /** Same shape as hint, but for a genuine physical-safety concern rather than an ordinary "won't have its documented effect" advisory - rendered in its own red-bordered box so it doesn't blend in with the amber hint line. null means nothing to flag right now. */
  safetyWarning?: (values: FieldValues) => string | null;
  /** Same shape as hint, but rendered above this field's own row instead of below it - for context a reader needs *before* reaching this field (e.g. "everything from here down is disabled"), not after. Its own bordered box (like safetyWarning, amber instead of red) rather than a plain line, since it needs to read as a standalone note rather than blending into the field above it. null means nothing to flag right now. */
  noteBefore?: (values: FieldValues) => string | null;
}

export interface NumberControl extends BaseControl {
  kind: "number";
  key: string;
  /** Highest raw value the firmware can actually store for this field (always uint8_t/0-255 unless in WIDE_RAW_FIELDS below) - the C type it's ultimately assigned/cast to in src/*.c, not a business-logic "sane range". Min is always 0: every raw field in this firmware is an unsigned type. */
  rawMax: number;
  /** Bounded, sane range for a slider control - only set on fields whose tooltip already states an explicit real-world bound (e.g. "0% = ... 100% = ...", or "the firmware clamps this to 22A regardless"), never an invented one. Absent means the field stays a plain number input - most fields have no such stated bound, only rawMax's raw storage width. */
  sliderRange?: { min: number; max: number; step?: number };
  /** Draws a thin red boundary line on the slider track at this raw value - purely visual, doesn't block anything (see safetyWarning for the accompanying text warning). For a value past which the field's own documented bound stops being a hard firmware ceiling and starts being "the firmware will let you, but verify your hardware first" (e.g. batteryCurrentMax's old 18A ceiling, now raised to 22A but only vetted on some controller revisions). Must fall strictly between sliderRange's min/max to render. */
  dangerAbove?: number;
  /** The single currently-recommended value for this field given the rest of the form (e.g. battery current max depends on the Motor type selection), when the tooltip documents one for the current configuration - rendered as a labeled snap point on the slider. Returns null when no recommendation applies (e.g. dependent control not yet set). */
  recommendedValue?: (values: FieldValues) => { value: number; label: string } | null;
  /** Quick-fill buttons for common real-world values that need a computation to turn into this field's raw unit (e.g. battery capacity in Wh from a pack's Ah rating x its system voltage) - unlike recommendedValue there's no single "right" one, so this renders a button per entry rather than a slider snap point. Empty array (not null) when nothing to show for the current configuration (e.g. dependent control not yet set), since this isn't paired with a slider that needs a null/present distinction. */
  presetValues?: (values: FieldValues) => { value: number; label: string }[];
}

export interface TextControl extends BaseControl {
  kind: "text";
  key: string;
}

export interface CheckboxControl extends BaseControl {
  kind: "checkbox";
  key: string;
}

export interface SignedOffsetControl extends BaseControl {
  kind: "signedOffset";
  key: string;
  middle: number;
}

export interface RadioOption {
  label: string;
  /** Raw field values this option sets when selected. Any group member not listed is set false. */
  values: FieldValues;
  /** Path to a thumbnail (under /displays/, see public/displays/) - only read when the control's own `visualPicker` is set. */
  image?: string;
}

export interface RadioControl extends BaseControl {
  kind: "radio";
  /** Every raw field this group can touch (used to detect the current selection and for coverage checks). */
  groupKeys: string[];
  options: RadioOption[];
  /** Forces a toggle-button group even above TOGGLE_GROUP_MAX_OPTIONS (dom.ts) - see IntSelectControl's own toggleGroup for the same rationale (e.g. Brake feature's 4 short, at-a-glance options). */
  toggleGroup?: boolean;
  /** Renders as an image-card grid (render/control.ts, dom.ts's renderVisualPicker) instead of the usual toggle-group/<select> - for a control whose options are meaningfully told apart by a picture (currently just Display type). Every RadioOption needs `image` set when this is on. */
  visualPicker?: boolean;
  /** Extra image-only entries shown alongside the real options in a visualPicker, permanently disabled/unselectable - for values this tool doesn't support yet but a user might still recognize their own hardware in (so they know at a glance "not supported" rather than not finding their display at all). Purely decorative: no raw field is touched by these, they're never part of `options`/`groupKeys`. */
  unimplementedOptions?: { label: string; image: string }[];
}

export interface IntSelectControl extends BaseControl {
  kind: "intSelect";
  key: string;
  options: { label: string; value: number }[];
  /** Renders label above a 100%-wide <select> instead of the usual same-line fixed-width layout - for standalone (non-grouped) intSelect fields whose option text is too long for the generic 8rem select without clipping. Grouped intSelect families (Lights configuration 1-3, Display data 1-6) already get this via their own "stacked" card layout, so this flag only matters for fields outside a group. */
  fullWidth?: boolean;
  /** Forces a toggle-button group even above TOGGLE_GROUP_MAX_OPTIONS (dom.ts) - for a field whose options are short, few enough to scan at a glance, and benefit from being always-visible (e.g. Battery cell count's 4 fixed voltage classes) despite exceeding the generic 3-option threshold that exists to stop toggle groups from eating space on less scannable fields. */
  toggleGroup?: boolean;
}

export type Control =
  NumberControl | TextControl | CheckboxControl | SignedOffsetControl | RadioControl | IntSelectControl;

/** Per-raw-field metadata a src/sections/*.ts file supplies for one schema field - looked up by ui-model.ts's buildControls() while it walks RAW_FIELDS in schema order. A field with no entry anywhere still gets a control (humanized label, "misc" section) - see buildControls()'s own comment. */
export interface ExplicitFieldMeta {
  label: string;
  section: string;
  kind?: "text";
  tooltip?: string;
  dependsOn?: DependsOn;
  required?: boolean;
  hint?: (values: FieldValues) => string | null;
  safetyWarning?: (values: FieldValues) => string | null;
  noteBefore?: (values: FieldValues) => string | null;
  speedField?: "kmh" | "kmhX10";
  distanceField?: "mm";
  sliderRange?: { min: number; max: number; step?: number };
  dangerAbove?: number;
  recommendedValue?: (values: FieldValues) => { value: number; label: string } | null;
  presetValues?: (values: FieldValues) => { value: number; label: string }[];
}

export function radio(
  label: string,
  section: string,
  groupKeys: string[],
  options: RadioOption[],
  tooltip?: string,
  dependsOn?: DependsOn,
  required?: boolean,
): RadioControl {
  return { kind: "radio", label, section, groupKeys, options, tooltip, dependsOn, required };
}

/** Marketed system voltage for each battery cell count (battery.ts's BATTERY_CELL_COUNT option labels, e.g. "13 (48V)") - not a nominal-cell-chemistry computation, just the number riders already shop by. */
export const CELLS_TO_SYSTEM_VOLTAGE: Record<number, number> = { 7: 24, 10: 36, 13: 48, 14: 52 };

export function motorVoltageOf(v: FieldValues): number | null {
  if (v.motorTypeTSDZ2_36V === true) return 36;
  if (v.motorTypeTSDZ2_48V === true) return 48;
  return null;
}

export function batteryVoltageOf(v: FieldValues): number | null {
  const cells = v.batteryCellsNumber;
  return typeof cells === "number" ? (CELLS_TO_SYSTEM_VOLTAGE[cells] ?? null) : null;
}

/**
 * Maps an assist-level repeater card's stem (see groupSectionControls/
 * repeaterTag in render/control-group.ts) to the ASSIST_MODE_ON_STARTUP
 * flag(s) that make it the mode running at power-on. Hybrid runs both Power
 * (high cadence) and Torque (low cadence) - see ASSIST_MODE_ON_STARTUP's own
 * tooltip - so it matches both of those cards at once; Cadence/eMTB only
 * ever activate under their own dedicated startup mode. Lives here (not
 * assist-level5.ts, where the rest of the assist-level-5 logic lives) and
 * takes `values` as an explicit parameter rather than reading `state`
 * directly (unlike assist-level5.ts's startupAssistNote, its sibling) so
 * sections/assist.ts - a plain data file - can use dz40AssistFamilyDead
 * below in a field's own dependsOn without importing assist-level5.ts,
 * which pulls in app-state.ts -> defaults.ts -> proven-defaults.ts's
 * Vite-only `import.meta.glob` and breaks the node:test suite (which loads
 * sections/*.ts under plain Node, no Vite transform) the moment anything
 * under sections/ reaches that chain transitively.
 */
export const STARTUP_ASSIST_STEM_KEYS: Record<string, string[]> = {
  "Power assist level": ["assistStartupPower", "assistStartupHybrid"],
  "Torque assist level": ["assistStartupTorque", "assistStartupHybrid"],
  "Cadence assist level": ["assistStartupCadence"],
  "eMTB assist level": ["assistStartupEmtb"],
};

/**
 * True when an assist-level family's card should be dead-weight for DZ40:
 * DZ40 has no lights-button menu, so the SET PARAMETER screen that lets
 * every other display switch "Assist mode on power-on" live
 * (src/ebike_app.c's TOUR/SPORT menu-index cases - gated behind the same
 * lights-button double-press as Riding modes' Street/Offroad toggle, see
 * sections/riding-modes.ts's dz40OffroadDead/dz40StreetDead) is unreachable
 * there too - so for DZ40, whichever assist-mode family ISN'T the current
 * startup selection never actually runs, same shape as the Riding modes
 * page's Offroad/Street split. sections/assist.ts uses this in each field's
 * own dependsOn (so renderControlGroup's existing enabled/field-disabled
 * machinery dims+disables the whole card and every cell for free, no new
 * mechanism needed there) and render/control-group.ts uses it again to show
 * one consolidated note at the top of the card, same pattern as
 * riding-modes-page.ts's deadCardNote. Always false for every other display
 * type, which really can switch modes live.
 */
export function dz40AssistFamilyDead(values: FieldValues, stem: string): boolean {
  if (values.displayTypeDZ40 !== true) return false;
  const keys = STARTUP_ASSIST_STEM_KEYS[stem];
  return keys ? !keys.some((k) => values[k] === true) : false;
}
