// Pure session/file-status logic, deliberately kept free of DOM/localStorage
// side effects so it's unit-testable directly - unlike main.ts, which can't
// be imported outside a real browser (it grabs #app off `document` and
// touches localStorage at module scope as soon as it loads).

import type { FieldValues } from "./ini-import.ts";

export interface Session {
  values: FieldValues;
  baselineValues: FieldValues;
  /** Provenance embedded in a saved .tsdz2.json (the .ini it was ultimately derived from, if any) - carried through load/save round trips. Not the same as "what file is currently loaded"; see loadedFileName for that. */
  sourceImport: string | null;
  currentFileBaseName: string;
  /** `${currentFileBaseName}.tsdz2.json` as of whatever was last imported/loaded/saved/renamed, or null if nothing's been loaded (still on firmware defaults) - always this tool's own canonical extension, even right after importing an .ini (main.ts's fileInputIni handler converts immediately, never persists the literal .ini name here). A session written before that normalization existed may still hold an old literal name/extension verbatim, since this field is never rewritten retroactively. Optional because sessions persisted before this field existed at all won't have it - see loadedFileNameFromSession(). */
  loadedFileName?: string | null;
  /** loadedFileName's own baseline, same role as baselineValues/baselineNotes - lets an unsaved rename (see the topbar's rename pencil) count as a real unsaved edit instead of silently not tracking it. Optional because sessions persisted before renaming existed won't have it - see loadedFileNameIsDirty(). */
  baselineLoadedFileName?: string | null;
  /** Free-text notes, same field as Tsdz2ConfigFile.notes - optional because sessions persisted before this field existed won't have it; treat as "" when absent. */
  notes?: string;
  /** notes' own baseline, same role as baselineValues - lets sessionIsDirty()/the restore banner treat an edited-but-unsaved note the same as any other unsaved edit. */
  baselineNotes?: string;
  activePage: string;
  /** Build & Flash page state - persisted like everything else so a refresh doesn't lose a build that took ~30s to produce. Only cleared by clearBuiltFirmware() (Import/Load - a deliberate "starting new work" action), not by a plain refresh or Reset to defaults. */
  firmwareHexText: string | null;
  firmwareHexName: string | null;
  /** Optional because sessions persisted before this field existed won't have it - treat as null (unknown provenance) when absent, same fallback pattern as notes/baselineNotes above. */
  firmwareHexSource?: "built" | "chosen" | null;
  buildError: string | null;
  savedAt: number;
}

/** True if any field in `values` differs from its counterpart in `baseline` - covers keys present in either side, so a field only present on one side (e.g. an older/newer schema shape) still counts as dirty. */
export function valuesAreDirty(values: FieldValues, baseline: FieldValues): boolean {
  const keys = new Set([...Object.keys(values), ...Object.keys(baseline)]);
  for (const k of keys) if (values[k] !== baseline[k]) return true;
  return false;
}

/** Falls back to `fallbackId` when `id` isn't one of `pageIds` - covers a persisted session missing activePage entirely (older session shape) or pointing at a stale one (e.g. a section was renamed). */
export function validPage(id: string | undefined, pageIds: readonly string[], fallbackId: string): string {
  if (id != null && pageIds.includes(id)) return id;
  return fallbackId;
}

/**
 * Reconstructs loadedFileName for a session persisted before that field
 * existed (older session shape) - best-effort from the fields it does have.
 *
 * loadedFileName is deliberately separate from sourceImport: sourceImport is
 * .ini provenance that survives .tsdz2.json save/load round trips unchanged,
 * so it can't be used to tell whether a .tsdz2.json was just loaded (a real
 * bug this shipped with once - loading a .tsdz2.json that carried forward
 * the same .ini provenance string left the header badge showing the old
 * .ini's name instead of the file just opened).
 */
export function loadedFileNameFromSession(session: Session): string | null {
  if (session.loadedFileName !== undefined) return session.loadedFileName;
  if (session.sourceImport) return session.sourceImport;
  return session.currentFileBaseName === "config" ? null : `${session.currentFileBaseName}.tsdz2.json`;
}

/** Text for the topbar's "Loaded: X" badge - the one place that should ever say what's currently open. */
export function loadedFileLabel(loadedFileName: string | null): string {
  return loadedFileName ? `Loaded: ${loadedFileName}` : "Loaded: firmware defaults (nothing imported)";
}

/**
 * baselineLoadedFileName with the same missing-field fallback
 * loadedFileNameIsDirty() below uses - a session persisted before renaming
 * existed has no baseline of its own, so its current (only) name is its own
 * baseline (not dirty). Shared so main.ts's restore-banner "Restore
 * edits"/"Discard edits" actions and loadedFileNameIsDirty() can't drift
 * apart on what "baseline" means for an old session shape.
 */
export function baselineLoadedFileNameFromSession(session: Session): string | null {
  return session.baselineLoadedFileName !== undefined
    ? session.baselineLoadedFileName
    : loadedFileNameFromSession(session);
}

/**
 * True if the loaded file has been renamed (via the topbar's rename pencil)
 * since the last import/load/reset/Save As - the loadedFileName counterpart
 * to valuesAreDirty().
 */
export function loadedFileNameIsDirty(session: Session): boolean {
  return loadedFileNameFromSession(session) !== baselineLoadedFileNameFromSession(session);
}
