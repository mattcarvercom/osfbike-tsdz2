import type { FieldValues } from "./ini-import.ts";

/**
 * "kmh" fields are always STORED in km/h but shown/typed converted to mph
 * when the Speed units setting is mph (the Java tool's own behavior,
 * confirmed from its *KeyReleased handlers) - these mirror its exact
 * conversion formulas so imported .ini round-trip identically.
 *
 * "kmhX10" fields (walk assist speed 1-4, walk assist speed limit) are
 * a different, fixed-point encoding: always km/h x10 with NO unit
 * conversion, ever - confirmed by grepping the Java source for a
 * TF_WALK_ASS_SPEED_*KeyReleased handler (there isn't one, unlike the "kmh"
 * fields) and by common.h's own comment on WALK_ASSIST_THRESHOLD_SPEED_X10
 * ("70 -> 7.0 kph"). Applying the mph formula to these silently produces
 * nonsense values whenever mph units are selected - kept fully separate.
 */
export function speedUnitSuffix(values: FieldValues): string {
  return values.unitsMiles === true || values.alternativeMiles === true ? "mph" : "km/h";
}

export function speedRawToDisplay(raw: number, values: FieldValues): number {
  if (values.unitsMiles === true || values.alternativeMiles === true) return Math.floor((raw * 10 + 5) / 16);
  return raw;
}

export function speedDisplayToRaw(display: number, values: FieldValues): number {
  if (values.unitsMiles === true || values.alternativeMiles === true) return Math.floor((display * 16) / 10);
  return display;
}

/**
 * Purely informational mph readout shown next to "kmhX10" fields (walk
 * assist speed 1-4/limit) - those never convert their stored/edited value
 * (see the comment above), but at these low speeds a bare km/h x10 integer
 * is hard to eyeball in mph, so show it as a live side-note instead of
 * touching the actual raw value or the Speed units setting.
 */
export function kmhX10ToMph(rawX10: number): string {
  return ((rawX10 / 10) * 0.621371).toFixed(1);
}

/**
 * Purely informational mph readout for a "kmh" field's currently-displayed
 * km/h value (Speed units set to km/h, so the input itself shows the raw
 * value unconverted) - the reverse-direction km/h readout for the mph case
 * already exists inline in render/control.ts (it has to match
 * speedDisplayToRaw() exactly, since that one doubles as "what will actually
 * get saved"). This one's decorative only, same as kmhX10ToMph above, so a
 * plain multiply is fine.
 */
export function kmhToMph(raw: number): string {
  return (raw * 0.621371).toFixed(1);
}

/**
 * Purely informational inches readout next to a "mm" distanceField (currently
 * just Wheel circumference) - nothing in this app lets you edit distance in
 * inches, this is a live side-note only, same idea as kmhX10ToMph above.
 */
export function mmToInches(mm: number): string {
  return (mm / 25.4).toFixed(1);
}
