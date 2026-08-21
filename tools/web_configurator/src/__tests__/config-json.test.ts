import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toConfigFile, serializeConfigFile, parseConfigFile, FORMAT_VERSION } from "../config-json.ts";
import { RAW_FIELDS } from "../schema.ts";
import type { FieldValues } from "../ini-import.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

function sampleValues(): FieldValues {
  const values: FieldValues = {};
  for (const f of RAW_FIELDS) values[f.key] = f.default;
  return values;
}

function fixtureFiles(): string[] {
  const dirs = [join("settings", "experimental"), join("settings", "proven")];
  const files: string[] = [];
  for (const dir of dirs) {
    const full = join(REPO_ROOT, dir);
    for (const name of readdirSync(full)) {
      if (name.endsWith(".tsdz2.json")) files.push(join(full, name));
    }
  }
  return files;
}

test("toConfigFile -> serializeConfigFile -> parseConfigFile round-trips every field with no warnings", () => {
  const values = sampleValues();
  const file = toConfigFile(values, "some.ini", "hello notes");
  const { file: parsed, warnings } = parseConfigFile(serializeConfigFile(file));
  assert.deepEqual(parsed.fields, values);
  assert.equal(parsed.sourceImport, "some.ini");
  assert.equal(parsed.notes, "hello notes");
  assert.deepEqual(warnings, []);
});

test("a field missing from the file (schema grew since it was saved) defaults instead of throwing, and is reported as a warning", () => {
  const values = sampleValues();
  const file = toConfigFile(values, null, "");
  const raw = JSON.parse(serializeConfigFile(file));
  const droppedKey = RAW_FIELDS[RAW_FIELDS.length - 1].key;
  const droppedDefault = RAW_FIELDS[RAW_FIELDS.length - 1].default;
  delete raw.fields[droppedKey];
  const { file: parsed, warnings } = parseConfigFile(JSON.stringify(raw));
  assert.equal(parsed.fields[droppedKey], droppedDefault);
  assert.ok(warnings.length === 1 && warnings[0].includes(droppedKey), warnings.join("\n"));
});

test("multiple missing fields all default and are all named in the one warning", () => {
  const values = sampleValues();
  const file = toConfigFile(values, null, "");
  const raw = JSON.parse(serializeConfigFile(file));
  delete raw.fields[RAW_FIELDS[0].key];
  delete raw.fields[RAW_FIELDS[1].key];
  const { file: parsed, warnings } = parseConfigFile(JSON.stringify(raw));
  assert.equal(parsed.fields[RAW_FIELDS[0].key], RAW_FIELDS[0].default);
  assert.equal(parsed.fields[RAW_FIELDS[1].key], RAW_FIELDS[1].default);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes(RAW_FIELDS[0].key) && warnings[0].includes(RAW_FIELDS[1].key), warnings[0]);
});

test("parseConfigFile: throws on invalid JSON", () => {
  assert.throws(() => parseConfigFile("not json at all"));
});

test("parseConfigFile: throws when the top level isn't an object", () => {
  assert.throws(() => parseConfigFile("42"));
  assert.throws(() => parseConfigFile("null"));
});

test("parseConfigFile: throws on a formatVersion mismatch", () => {
  const raw = JSON.parse(serializeConfigFile(toConfigFile(sampleValues(), null, "")));
  raw.formatVersion = FORMAT_VERSION + 1;
  assert.throws(() => parseConfigFile(JSON.stringify(raw)), /formatVersion/);
});

test("parseConfigFile: throws when the fields object itself is missing", () => {
  assert.throws(() => parseConfigFile(JSON.stringify({ formatVersion: FORMAT_VERSION })));
});

test("every checked-in settings/**/*.tsdz2.json fixture parses with zero missing-field warnings - a fixture falling behind the schema is a real regression, not just a load-time nuisance", () => {
  const files = fixtureFiles();
  assert.ok(files.length > 0, "expected at least one fixture .tsdz2.json file, found none");
  for (const path of files) {
    const text = readFileSync(path, "utf-8");
    const { warnings } = parseConfigFile(text);
    assert.deepEqual(warnings, [], `${path}: ${warnings.join("\n")}`);
  }
});
