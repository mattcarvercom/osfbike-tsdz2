import { test } from "node:test";
import assert from "node:assert/strict";
import { RAW_FIELDS } from "../schema.ts";
import { buildControls, coveredKeys } from "../ui-model.ts";

test("every schema field is covered by exactly one UI control (except the 4 known-dead fields)", () => {
  const controls = buildControls();
  const covered = coveredKeys(controls);
  const knownDead = new Set([
    "streetThrottleEnabled_UNUSED",
    "throttleLegal_UNUSED",
    "motorTypeTSDZ8",
    "streetPowerLimEnabled",
  ]);

  for (const f of RAW_FIELDS) {
    if (knownDead.has(f.key)) continue;
    assert.ok(covered.has(f.key), `field "${f.key}" has no UI control`);
  }
});

test("radio group options are internally consistent (each option's keys are a subset of the group's keys)", () => {
  const controls = buildControls();
  for (const c of controls) {
    if (c.kind !== "radio") continue;
    for (const opt of c.options) {
      for (const k of Object.keys(opt.values)) {
        assert.ok(
          c.groupKeys.includes(k),
          `radio "${c.label}" option "${opt.label}" sets "${k}" which isn't in groupKeys`,
        );
      }
    }
  }
});
