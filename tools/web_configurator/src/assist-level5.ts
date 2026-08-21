// Assist level 5's cross-field computation (config.h's ASSIST_LEVEL_5_PERCENT
// applied to the Power/Torque/Cadence/eMTB/Cruise levels it scales) - shared
// by render/control.ts's assistLevel5Percent field, render/assist-chart.ts's
// live bar, and render/control-group.ts's "Power-on default" badges.

import { state } from "./app-state.ts";
import { STARTUP_ASSIST_STEM_KEYS } from "./control-types.ts";

/**
 * Raw fields the firmware multiplies by ASSIST_LEVEL_5_PERCENT/100 when PAS5
 * is pressed - ECO-tier (level index 1) in Before Eco mode, TURBO-tier
 * (level index 4) in After Turbo mode. Verified against src/ebike_app.c: the
 * generic "set assist parameter" block (~line 2860-2873) computes
 * ui8_riding_mode_parameter from ui8_riding_mode_parameter_array[current
 * riding mode][level] and applies the ASSIST_LEVEL_5_PERCENT scaling there,
 * and apply_power_assist (line 770), apply_torque_assist (868),
 * apply_cadence_assist (913) and apply_emtb_assist (974) all read that same
 * shared, already-scaled variable directly - so Power/Torque/Cadence/eMTB
 * assist are all in scope. Cruise has its own separate lookup+scaling (line
 * 1195-1198) for the same reason, hence its own entry - and unlike the
 * others, the firmware multiplies cruise's raw km/h value by 10 *before*
 * applying the percent (ui16_wheel_speed_target_x10 = array_value * 10U),
 * so its `scale` is 10, not 1 - easy to miss and got missed in an earlier
 * pass of this exact check, so don't drop it if this list changes again.
 * Walk assist shares the array too, but its field's realistic max (a
 * handful of km/h, x10) never gets anywhere near overflowing even at
 * ASSIST_LEVEL_5_PERCENT's own 255 max, so it's not included here.
 *
 * Power is the other easy-to-miss one (found 2026-08-12, same class of bug
 * as the Cruise x10 note above): `key` here is the UI's powerAssist1/
 * powerAssist4 field, but that's config.h's PERCENT value (100 = 100%,
 * up to 511 - see POWER_ASSIST_TOOLTIP in ui-model.ts), not what actually
 * lands in ui8_riding_mode_parameter_array. main.h halves it first -
 * `POWER_ASSIST_LEVEL_ECO (uint8_t)(POWER_ASSIST_LEVEL_1 / 2)` - so the
 * array (and therefore this PAS5 math) operates on HALF the UI value.
 * `scale: 0.5` reproduces that, and assistLevel5Result() floors the scaled
 * base (not just the final result) so the two truncations happen in the
 * same order the firmware does them, since flooring only once at the end
 * can disagree with the firmware by 1 on odd inputs (e.g. config 481 at
 * 99%: firmware floors 481/2=240 first then 240*99/100=237; flooring only
 * the combined 481*0.5*99/100 once gives 238 instead).
 */
export interface AssistLevel5RefField {
  key: string;
  label: string;
  scale: number;
  /** Suffix for the computed-value display - "" for the assist-percentage fields (bare number, matching how those fields display everywhere else), " km/h" for cruise (the x10-encoded result is divided back down for readability). */
  unit: string;
}
export const ASSIST_LEVEL_5_ECO_FIELDS: AssistLevel5RefField[] = [
  { key: "powerAssist1", label: "Power", scale: 0.5, unit: "" },
  { key: "torqueAssist1", label: "Torque", scale: 1, unit: "" },
  { key: "cadenceAssist1", label: "Cadence", scale: 1, unit: "" },
  { key: "emtbAssist1", label: "eMTB", scale: 1, unit: "" },
  { key: "cruiseSpeed1", label: "Cruise", scale: 10, unit: " km/h" },
];
export const ASSIST_LEVEL_5_TURBO_FIELDS: AssistLevel5RefField[] = [
  { key: "powerAssist4", label: "Power", scale: 0.5, unit: "" },
  { key: "torqueAssist4", label: "Torque", scale: 1, unit: "" },
  { key: "cadenceAssist4", label: "Cadence", scale: 1, unit: "" },
  { key: "emtbAssist4", label: "eMTB", scale: 1, unit: "" },
  { key: "cruiseSpeed4", label: "Cruise", scale: 10, unit: " km/h" },
];

/** Fields relevant to the current Assist level 5 mode - empty when the feature is off (mode 0), which the field's own dependsOn already keeps hidden. */
export function assistLevel5ActiveFields(): AssistLevel5RefField[] {
  const mode = Number(state.values.assistLevel5Mode);
  return mode === 2 ? ASSIST_LEVEL_5_TURBO_FIELDS : mode === 1 ? ASSIST_LEVEL_5_ECO_FIELDS : [];
}

/**
 * One reference field's PAS5 result, mirroring the firmware's own integer
 * math exactly: (raw x scale x percent) / 100, truncated, then wrapped
 * modulo 256 the same way a bare (uint8_t) cast wraps a non-negative value -
 * see ASSIST_LEVEL_5_ECO_FIELDS/TURBO_FIELDS's doc comment for why `scale`
 * exists and the exact source lines this mirrors.
 */
export function assistLevel5Result(
  field: AssistLevel5RefField,
  percent: number,
): { scaledBase: number; result: number; wrapped: number; overflowed: boolean } {
  const raw = Number(state.values[field.key] ?? 0);
  // Floored here, not just on the final result - matters for Power's
  // scale: 0.5 (see this file's ASSIST_LEVEL_5_ECO_FIELDS/TURBO_FIELDS doc
  // comment), where the firmware truncates once at config/2 (into the
  // uint8_t array) and again at array*percent/100 - two separate integer
  // divisions, not one combined float multiply.
  const scaledBase = Math.floor(raw * field.scale);
  const result = Math.floor((scaledBase * percent) / 100);
  return { scaledBase, result, wrapped: result % 256, overflowed: result > 255 };
}

/**
 * In After Turbo mode, (TURBO field x percent / 100) gets cast straight back
 * into the same uint8_t (0-255) every riding-mode parameter uses, with no
 * clamping (see ASSIST_LEVEL_5_PERCENT's own tooltip for the exact
 * expression) - so a combination that multiplies out past 255 doesn't cap
 * there, it silently wraps modulo 256 into a smaller, wrong value.
 */
export function assistLevel5OverflowError(percent: number): string | null {
  if (Number(state.values.assistLevel5Mode) !== 2) return null; // only After Turbo multiplies upward - Before Eco's percent must stay under 100, which can only shrink the ECO value, never overflow it
  const offenders: string[] = [];
  for (const field of ASSIST_LEVEL_5_TURBO_FIELDS) {
    const { scaledBase, result, wrapped, overflowed } = assistLevel5Result(field, percent);
    if (overflowed) offenders.push(`${field.label} (${scaledBase} x ${percent}% = ${result}, wraps to ${wrapped})`);
  }
  if (offenders.length === 0) return null;
  return `Overflows the firmware's uint8_t storage in After Turbo mode: ${offenders.join("; ")}. Lower this percentage or the affected TURBO field(s) so every product stays <= 255.`;
}

/** Maps a repeater card's detected stem (see groupSectionControls/repeaterTag in render/control-group.ts) to the matching label in ASSIST_LEVEL_5_ECO_FIELDS/TURBO_FIELDS, so render/assist-chart.ts knows which families get a live Assist level 5 bar. Deliberately excludes Cruise/Walk assist speed - those are speed targets, not an assist-strength ramp, so a bar chart of them would be a different kind of chart entirely; scope this to the four "how strong is the boost" families the assist-level-5 request was actually about. */
export const STEM_TO_ASSIST5_LABEL: Record<string, string> = {
  "Power assist level": "Power",
  "Torque assist level": "Torque",
  "Cadence assist level": "Cadence",
  "eMTB assist level": "eMTB",
};

/** Badge text for an assist-level card if it's (part of) the current startup mode, else null. Dynamic off state.values, so it updates live as the "Assist mode on power-on" radio changes. */
export function startupAssistNote(stem: string): string | null {
  const keys = STARTUP_ASSIST_STEM_KEYS[stem];
  if (!keys || !keys.some((k) => state.values[k] === true)) return null;
  return state.values.assistStartupHybrid === true ? "Power-on default (Hybrid)" : "Power-on default";
}

/** Whether/where an Assist level 5 bar applies to one chart's family right now, given the current assistLevel5Mode - shared by render/assist-chart.ts's renderAssistCurveChart (to draw the bar) and render/control-group.ts's renderControlGroup (to reserve a matching placeholder column so the 4 real levels stay aligned with the chart above them). Null when level 5 is disabled or this family has no reference field for the active mode. */
export function assistLevel5ChartField(
  assist5Label: string,
): { field: AssistLevel5RefField; position: "before" | "after" } | null {
  const mode = Number(state.values.assistLevel5Mode);
  const fields = mode === 2 ? ASSIST_LEVEL_5_TURBO_FIELDS : mode === 1 ? ASSIST_LEVEL_5_ECO_FIELDS : null;
  const field = fields?.find((f) => f.label === assist5Label);
  if (!field) return null;
  return { field, position: mode === 1 ? "before" : "after" };
}

/**
 * A field's array-space wrapped byte, converted back to the same units as
 * its own input field - i.e. the inverse of assistLevel5Result()'s
 * `scaledBase = floor(raw * field.scale)` step. For Torque/Cadence/eMTB
 * (scale 1) this is a no-op; for Cruise (scale 10) it converts the x10-
 * encoded byte back to km/h; for Power (scale 0.5) it doubles the halved
 * array byte back to the config.h percent the Power assist level fields
 * actually display - without this, Power's badge/chart would show a number
 * in a different unit than the input box sitting right next to it.
 */
export function assistLevel5DisplayValue(field: AssistLevel5RefField, wrapped: number): number {
  return wrapped / field.scale;
}

/** One reference field's live badge, shown in the Assist level 5 % field's own computed list (see render/control.ts's call site). */
export function updateAssistLevel5Badge(
  badge: HTMLElement,
  field: AssistLevel5RefField,
  percent: number,
  labelPrefix = "",
): void {
  const { scaledBase, result, wrapped, overflowed } = assistLevel5Result(field, percent);
  const displayValue = assistLevel5DisplayValue(field, wrapped);
  const shown = field.unit === " km/h" ? displayValue.toFixed(1) : String(displayValue);
  badge.className = `assist5-badge${overflowed ? " assist5-badge-warn" : ""}`;
  badge.textContent = `${labelPrefix}${field.label} ${shown}${field.unit}`;
  badge.title = overflowed
    ? `Overflows the firmware's uint8_t: ${scaledBase} x ${percent}% = ${result}, wraps to ${wrapped}`
    : `${scaledBase} x ${percent}% / 100 = ${result}`;
}
