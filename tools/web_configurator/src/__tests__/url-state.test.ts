import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHash, buildHash } from "../url-state.ts";

test("parseHash: empty/bare hash yields null (no share link present)", () => {
  assert.equal(parseHash(""), null);
  assert.equal(parseHash("#"), null);
});

test("parseHash: page only, leading # optional", () => {
  assert.deepEqual(parseHash("#motor"), { page: "motor", field: null });
  assert.deepEqual(parseHash("motor"), { page: "motor", field: null });
});

test("parseHash: page and field", () => {
  assert.deepEqual(parseHash("#motor/motorMaxCurrent"), { page: "motor", field: "motorMaxCurrent" });
});

test("parseHash: decodes URI-encoded components", () => {
  assert.deepEqual(parseHash("#riding-modes/cruiseTargetSpeed%201"), {
    page: "riding-modes",
    field: "cruiseTargetSpeed 1",
  });
});

test("buildHash: page only", () => {
  assert.equal(buildHash("motor", null), "#motor");
});

test("buildHash: page and field, URI-encoded", () => {
  assert.equal(buildHash("motor", "motorMaxCurrent"), "#motor/motorMaxCurrent");
});

test("buildHash/parseHash round-trip", () => {
  const loc = { page: "battery", field: "liIonCellVoltsFull" };
  assert.deepEqual(parseHash(buildHash(loc.page, loc.field)), loc);
});
