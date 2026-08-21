// Read-only, one-way .ini importer. Mirrors loadSettings() (lines 206-449 of
// TSDZ2_Configurator.java) exactly, including its fallback-to-default
// behavior for lines missing from older files. Never writes .ini back out -
// see the plan doc's non-goal on bidirectional .ini support.

import { RAW_FIELDS, type RawField } from "./schema.ts";

export type FieldValue = boolean | number | string;
export type FieldValues = Record<string, FieldValue>;

export interface ImportResult {
  values: FieldValues;
  warnings: string[];
}

function parseField(f: RawField, raw: string): FieldValue {
  switch (f.type) {
    case "bool":
      return raw.trim().toLowerCase() === "true";
    case "int": {
      const n = parseInt(raw.trim(), 10);
      if (Number.isNaN(n)) {
        throw new Error(`Corrupt .ini file or invalid data (field "${f.key}": "${raw}")`);
      }
      return n;
    }
    case "string":
      return raw;
  }
}

export function importIni(text: string): ImportResult {
  // Java's BufferedReader.readLine() splits on \n, \r, or \r\n and strips
  // the terminator; a file ending in a final line terminator does NOT
  // produce one more empty readLine() result before true EOF (the next
  // call just returns null). JS's String.split on the same regex does add
  // that phantom trailing "" element, so drop it here to match - otherwise
  // it reads as "one more field's worth of real data present" to the
  // tailGroup presence check below, which used to be harmless only because
  // RAW_FIELDS never had a field positioned to reach it (found when adding
  // tailGroup 8: 3 of 5 real fixture .ini files end in a trailing newline,
  // and each has a phantom "line" this stripped one field short).
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let cursor = 0;
  const values: FieldValues = {};
  const warnings: string[] = [];
  const tailGroupPresent = new Map<number, boolean>();

  for (const f of RAW_FIELDS) {
    if (f.tailGroup !== undefined) {
      if (!tailGroupPresent.has(f.tailGroup)) {
        const present = cursor < lines.length;
        tailGroupPresent.set(f.tailGroup, present);
        if (!present) {
          const groupKeys = RAW_FIELDS.filter((x) => x.tailGroup === f.tailGroup).map((x) => x.key);
          warnings.push(`File predates the "${groupKeys.join(", ")}" fields - using defaults for them.`);
        }
      }
      if (!tailGroupPresent.get(f.tailGroup)) {
        values[f.key] = f.default;
        continue;
      }
    } else if (f.optional && cursor >= lines.length) {
      values[f.key] = f.default;
      continue;
    }

    const raw = lines[cursor];
    if (raw === undefined) {
      throw new Error(`Corrupt .ini file or invalid data (unexpected end of file before field "${f.key}")`);
    }
    cursor++;
    values[f.key] = parseField(f, raw);
  }

  // loadSettings() derives throttleMode/throttleModeOnStreetMode from other
  // flags (not a static default) when tail group 1 is absent (lines 375-392).
  if (!tailGroupPresent.get(1)) {
    const throttleEnabled = values.optionalAdcThrottle === true;
    const streetThrottleEnabled = values.streetThrottleEnabled_UNUSED === true;
    const throttleLegal = values.throttleLegal_UNUSED === true;
    values.throttleMode = throttleEnabled ? 4 /* UNCONDITIONAL */ : 0; /* DISABLED */
    values.throttleModeOnStreetMode =
      throttleEnabled && streetThrottleEnabled
        ? throttleLegal
          ? 1 /* PEDALING */
          : 4 /* UNCONDITIONAL */
        : 0; /* DISABLED */
  }

  // loadSettings() (lines 662-704) resolves the units combo box from these 3
  // raw flags with a strict priority - unitsMiles wins over alternativeMiles
  // wins over kilometers - not a "these 3 booleans form one mutually
  // exclusive choice" exact-match requirement. Nothing in the .ini format or
  // firmware enforces that exclusivity; only the Java tool's own UI
  // change-handler (JCB_UNITS_TYPEItemStateChanged) resets all three on
  // every edit, so a file edited outside a single clean combo-box selection
  // (e.g. switched from "alt. mph" to "Miles" without the alternativeMiles
  // flag getting cleared) can legitimately have more than one set. Without
  // this, an exact-match radio lookup on such a file falls back to its first
  // option (km/h) instead of the units the Java tool would actually show.
  const rawUnitsConflict =
    (values.unitsMiles === true && values.alternativeMiles === true) ||
    (values.unitsKilometers === true && (values.unitsMiles === true || values.alternativeMiles === true));
  if (values.unitsMiles === true) {
    values.unitsKilometers = false;
    values.alternativeMiles = false;
  } else if (values.alternativeMiles === true) {
    values.unitsKilometers = false;
  } else {
    values.unitsKilometers = true;
  }
  if (rawUnitsConflict) {
    warnings.push(
      "File had more than one speed-units flag set (unitsKilometers/unitsMiles/alternativeMiles) - resolved using the same priority the Java tool's loader uses (mph, then alt. mph, then km/h).",
    );
  }

  return { values, warnings };
}
