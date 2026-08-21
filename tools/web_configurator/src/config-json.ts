// The tool's own save format: <name>.tsdz2.json. Always "Save As" to a new
// file - this never overwrites an imported .ini (see the plan doc's
// one-way-import non-goal). formatVersion is this file format's own
// forward-compat mechanism, independent of any future EEPROM schema
// version byte (phase 2, not implemented here) - it guards against an
// actually-incompatible future format; ordinary schema growth (a new field
// added later) is handled per-field by parseConfigFile() defaulting
// whatever's missing, not by bumping this.

import { RAW_FIELDS } from "./schema.ts";
import type { FieldValues } from "./ini-import.ts";

export const FORMAT_VERSION = 1;

export interface Tsdz2ConfigFile {
  formatVersion: number;
  sourceImport: string | null;
  /** Free-text, user-authored - not a firmware setting, never touches config.h. Optional on read (older saved files won't have it) so bumping formatVersion isn't needed just to add this. */
  notes: string;
  fields: FieldValues;
}

export function toConfigFile(values: FieldValues, sourceImport: string | null, notes: string): Tsdz2ConfigFile {
  return { formatVersion: FORMAT_VERSION, sourceImport, notes, fields: values };
}

export function serializeConfigFile(file: Tsdz2ConfigFile): string {
  return JSON.stringify(file, null, 2);
}

export interface ParsedConfigFile {
  file: Tsdz2ConfigFile;
  /** One entry per field missing from the file (schema grew since it was saved) - same "predates this field, defaulted" idea as importIni()'s tailGroup warnings, just per-field instead of per-group since a keyed .tsdz2.json has no positional "ran out of lines" concept. Empty when the file has every current field. */
  warnings: string[];
}

export function parseConfigFile(text: string): ParsedConfigFile {
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Not a valid .tsdz2.json file: not an object");
  }
  if (parsed.formatVersion !== FORMAT_VERSION) {
    throw new Error(`Unsupported .tsdz2.json formatVersion ${parsed.formatVersion} (expected ${FORMAT_VERSION})`);
  }
  if (typeof parsed.fields !== "object" || parsed.fields === null) {
    throw new Error("Not a valid .tsdz2.json file: missing fields object");
  }
  // Missing individual fields default rather than fail the whole load - this
  // is a single-user, never-distributed tool, and a field the schema grew
  // *after* this file was saved (e.g. a new checkbox added later) is exactly
  // the same "older file, newer schema" situation importIni()'s tailGroup
  // fallback already handles gracefully for .ini - a .tsdz2.json predating a
  // field deserves the same treatment, not a hard error over what's really
  // just additive schema growth. FORMAT_VERSION above still guards against
  // an actually-incompatible future format.
  const values: FieldValues = {};
  const missing: string[] = [];
  for (const f of RAW_FIELDS) {
    if (f.key in parsed.fields) {
      values[f.key] = parsed.fields[f.key];
    } else {
      values[f.key] = f.default;
      missing.push(f.key);
    }
  }
  return {
    file: {
      formatVersion: parsed.formatVersion,
      sourceImport: parsed.sourceImport ?? null,
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      fields: values,
    },
    warnings: missing.length ? [`File predates these field(s) - using defaults: ${missing.join(", ")}.`] : [],
  };
}
