// Pure logic for buildFirmwareHex's runtime-helper discovery loop (see
// sdcc-build.ts), split into its own file with zero Vite-specific features
// (sdcc-build.ts itself uses import.meta.glob at module scope, a Vite-only
// build-time macro that plain `node --test` can't import at all) so this
// part is unit-testable directly.

/** Extracts symbol names from sdld's `?ASlink-Warning-Undefined Global '___foo' referenced by module '...'` lines. */
export function parseUndefinedGlobals(log: string[]): string[] {
  const symbols: string[] = [];
  for (const line of log) {
    const m = line.match(/Undefined Global '([^']+)'/);
    if (m) symbols.push(m[1]);
  }
  return symbols;
}

/**
 * Given this round's undefined symbols, which runtime-helper source files
 * (not yet included) resolve them? Drives buildFirmwareHex's link/discover/
 * link-again loop - separated out as a pure function because this exact
 * step has had real bugs before (a missing HELPER_SYMBOLS entry silently
 * left a real symbol unresolved even though the file providing it was right
 * there - see tools/CLAUDE.md's 2026-08-12 entry on _mulschar.c). Dedupes
 * (one file can resolve several missing symbols, e.g. _mulschar.c) and
 * excludes files already pulled in on an earlier iteration.
 */
export function nextHelperFiles(
  missingSymbols: string[],
  helperSymbols: Record<string, string>,
  alreadyIncluded: ReadonlySet<string>,
): string[] {
  const files = new Set(missingSymbols.map((s) => helperSymbols[s]).filter((f): f is string => !!f));
  return [...files].filter((f) => !alreadyIncluded.has(f));
}
