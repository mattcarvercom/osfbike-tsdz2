// "Reset to defaults" uses this real, field-tested 48V config
// (settings/proven/Default_Settings_TSDZ2_48V.ini) rather than schema.ts's
// own per-field `default`s, which only exist to backfill lines missing from
// an *older* .ini on import (see ini-import.ts) - they were never meant to
// double as a good starting configuration on their own.

import { importIni, type FieldValues } from "./ini-import.ts";

const PROVEN_48V_INI = Object.values(
  import.meta.glob("../../../settings/proven/Default_Settings_TSDZ2_48V.ini", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>,
)[0];

// The proven file itself ships 19 kHz PWM (pwm19kHz: true), but 18 kHz is
// the better efficiency/cadence tradeoff for a fresh default (see PWM_FREQ's
// tooltip in ui-model.ts) - explicitly overridden here rather than editing
// the proven .ini, which should stay a faithful copy of the field-tested file.
export const provenDefaultValues: FieldValues = {
  ...importIni(PROVEN_48V_INI).values,
  pwm18kHz: true,
  pwm19kHz: false,
};
