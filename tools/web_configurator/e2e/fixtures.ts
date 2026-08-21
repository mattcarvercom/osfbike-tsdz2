// Builds a real .tsdz2.json fixture on disk from a real .ini fixture, using
// the app's own ini-import.ts/config-json.ts (not a hand-written stand-in),
// so e2e scenarios can upload a file that's exactly what "Save As" would
// have produced without needing to drive a real download through the
// browser first.

import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importIni } from "../src/ini-import.ts";
import { toConfigFile, serializeConfigFile } from "../src/config-json.ts";

/**
 * Writes `<dir>/<jsonBaseName>.tsdz2.json`, a save of `iniPath`'s values
 * with sourceImport set to `iniPath`'s own basename - simulating "import
 * this .ini, then Save As" without needing a browser for that first step.
 */
export function buildTsdz2JsonFixture(
  iniPath: string,
  jsonBaseName: string,
  dir: string = mkdtempSync(join(tmpdir(), "tsdz2-e2e-")),
): string {
  const { values } = importIni(readFileSync(iniPath, "utf-8"));
  const iniName = iniPath.slice(iniPath.lastIndexOf("/") + 1);
  const file = toConfigFile(values, iniName);
  const outPath = join(dir, `${jsonBaseName}.tsdz2.json`);
  writeFileSync(outPath, serializeConfigFile(file));
  return outPath;
}
