import { test } from "node:test";
import assert from "node:assert/strict";
import {
  valuesAreDirty,
  validPage,
  loadedFileNameFromSession,
  baselineLoadedFileNameFromSession,
  loadedFileNameIsDirty,
  loadedFileLabel,
  type Session,
} from "../session.ts";

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    values: {},
    baselineValues: {},
    sourceImport: null,
    currentFileBaseName: "config",
    activePage: "motor",
    firmwareHexText: null,
    firmwareHexName: null,
    buildError: null,
    savedAt: 0,
    ...overrides,
  };
}

test("valuesAreDirty: false when values match baseline", () => {
  assert.equal(valuesAreDirty({ a: 1, b: "x" }, { a: 1, b: "x" }), false);
});

test("valuesAreDirty: true when a shared key differs", () => {
  assert.equal(valuesAreDirty({ a: 1 }, { a: 2 }), true);
});

test("valuesAreDirty: true when a key exists on only one side (older/newer schema shape)", () => {
  assert.equal(valuesAreDirty({ a: 1, extra: true }, { a: 1 }), true);
  assert.equal(valuesAreDirty({ a: 1 }, { a: 1, extra: true }), true);
});

test("validPage: keeps a known page id", () => {
  assert.equal(validPage("motor", ["motor", "battery"], "motor"), "motor");
  assert.equal(validPage("battery", ["motor", "battery"], "motor"), "battery");
});

test("validPage: falls back to fallbackId for a missing/stale/undefined id", () => {
  assert.equal(validPage(undefined, ["motor", "battery"], "motor"), "motor");
  assert.equal(validPage("renamed-section", ["motor", "battery"], "motor"), "motor");
});

test("loadedFileNameFromSession: uses loadedFileName when present, even if empty-string-falsy sourceImport differs", () => {
  const session = baseSession({ loadedFileName: "bar.tsdz2.json", sourceImport: "foo.ini" });
  assert.equal(loadedFileNameFromSession(session), "bar.tsdz2.json");
});

test("loadedFileNameFromSession: null loadedFileName (explicitly reset, e.g. after Reset to defaults) is respected, not treated as missing", () => {
  const session = baseSession({ loadedFileName: null, sourceImport: "leftover.ini" });
  assert.equal(loadedFileNameFromSession(session), null);
});

test("loadedFileNameFromSession: older session shape (field entirely absent) falls back to sourceImport", () => {
  const session = baseSession({ sourceImport: "foo.ini" });
  delete (session as Partial<Session>).loadedFileName;
  assert.equal(loadedFileNameFromSession(session), "foo.ini");
});

test("loadedFileNameFromSession: older session shape with no sourceImport falls back to currentFileBaseName, unless it's the untouched default", () => {
  const withFile = baseSession({ currentFileBaseName: "bar" });
  delete (withFile as Partial<Session>).loadedFileName;
  assert.equal(loadedFileNameFromSession(withFile), "bar.tsdz2.json");

  const untouched = baseSession({ currentFileBaseName: "config" });
  delete (untouched as Partial<Session>).loadedFileName;
  assert.equal(loadedFileNameFromSession(untouched), null);
});

test("loadedFileLabel: reflects the file just loaded, not provenance - regression test for the badge staying frozen on an old .ini name after loading a .tsdz2.json that carried the same provenance", () => {
  assert.equal(loadedFileLabel("foo.ini"), "Loaded: foo.ini");
  assert.equal(loadedFileLabel("bar.tsdz2.json"), "Loaded: bar.tsdz2.json");
  assert.equal(loadedFileLabel(null), "Loaded: firmware defaults (nothing imported)");
});

test("baselineLoadedFileNameFromSession: returns the real baseline when present, even if it differs from the current (renamed) name", () => {
  const session = baseSession({ loadedFileName: "renamed.tsdz2.json", baselineLoadedFileName: "foo.tsdz2.json" });
  assert.equal(baselineLoadedFileNameFromSession(session), "foo.tsdz2.json");
});

test("baselineLoadedFileNameFromSession: older session shape (field entirely absent) falls back to the current name - nothing to have renamed away from", () => {
  const session = baseSession({ loadedFileName: "foo.tsdz2.json" });
  delete (session as Partial<Session>).baselineLoadedFileName;
  assert.equal(baselineLoadedFileNameFromSession(session), "foo.tsdz2.json");
});

test("loadedFileNameIsDirty: false when the loaded name matches its baseline", () => {
  const session = baseSession({ loadedFileName: "foo.tsdz2.json", baselineLoadedFileName: "foo.tsdz2.json" });
  assert.equal(loadedFileNameIsDirty(session), false);
});

test("loadedFileNameIsDirty: true after an unsaved rename (loaded name diverges from its baseline)", () => {
  const session = baseSession({ loadedFileName: "renamed.tsdz2.json", baselineLoadedFileName: "foo.tsdz2.json" });
  assert.equal(loadedFileNameIsDirty(session), true);
});

test("loadedFileNameIsDirty: false for an older session shape with no baselineLoadedFileName at all - renaming didn't exist yet, so there's nothing to be dirty relative to", () => {
  const session = baseSession({ loadedFileName: "foo.tsdz2.json" });
  delete (session as Partial<Session>).baselineLoadedFileName;
  assert.equal(loadedFileNameIsDirty(session), false);
});
