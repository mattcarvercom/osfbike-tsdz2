import "./control-group.css";
import "./control.css"; // .revert-btn/.field-mph-hint/.help-toggle/.field-help/.field-note-box + the .field-group-cell checkbox styling, all reused here
import type { Control } from "../ui-model.ts";
import type { FieldValues } from "../ini-import.ts";
import { dz40AssistFamilyDead } from "../control-types.ts";
import { state, controlChanged, controlEnabled, persistSession, assistChartUpdaters } from "../app-state.ts";
import { el, icon, formatHelpText } from "../dom.ts";
import { renderApp } from "./app-shell.ts";
import { renderRevertButton, renderControl, rangeError } from "./control.ts";
import { renderAssistCurveChart } from "./assist-chart.ts";
import { speedUnitSuffix, speedRawToDisplay, speedDisplayToRaw, kmhX10ToMph, kmhToMph } from "../speed-units.ts";
import {
  STEM_TO_ASSIST5_LABEL,
  assistLevel5ChartField,
  assistLevel5Result,
  assistLevel5DisplayValue,
  startupAssistNote,
} from "../assist-level5.ts";

/** Same wording regardless of family - DZ40's Assist levels page can have up to 4 of these dead at once (e.g. Cadence/eMTB/one of Power-or-Torque, whenever the startup mode is Hybrid or a single non-Cadence/eMTB mode), and they'd all say the same thing, so there's no per-family variant to compute here unlike Riding modes' Offroad/Street pair (which needed to name each other). */
const DZ40_ASSIST_DEAD_NOTE =
  "Disabled: DZ40 can't switch Assist mode while riding (no lights-button menu) - only whichever mode is set as \"Assist mode on power-on\" (above) ever actually runs; this family isn't it.";

/** Unconditional for DZ40, unlike DZ40_ASSIST_DEAD_NOTE above - there's no "whichever one is active" question here, all three Lights configuration slots are always unreachable on DZ40 (see sections/lights.ts's dz40LightsConfigDead comment). */
const DZ40_LIGHTS_CONFIG_DEAD_NOTE =
  "Disabled: DZ40 can't reach the display's SET PARAMETER menu at all (no lights-button menu - its only long-press action is a plain headlight on/off) - \"Lights configuration on power-on\" above is permanent for DZ40, these three toggles never actually run.";

// ---- Numbered-family grouping (Cruise target speed 1-4, Display data 1-6,
// Power/Torque/Cadence/eMTB assist level 1-4, etc) -------------------------
//
// These account for ~40 of the ~135 fields and are exactly what made the UI
// read as a flat, positional dump (the thing this whole rewrite is about):
// each one is its own full-width row with an almost-identical label, styled
// no differently from a one-off setting. Detected automatically from the
// label text (a trailing "N", "N/M", or "N (TAG)") rather than hand-curated
// per-field, since hand-curating ~40 group memberships would be its own
// large, error-prone maintenance burden every time a field is renamed.

export interface FieldGroup {
  kind: "group";
  stem: string;
  members: { control: Control; tag: string }[];
  /** Extra checkbox controls rendered as their own full-width row inside this card, below the family grid - currently just the four Cruise-control-overrides-walk-assist toggles (one per level), kept as close as possible to the "Cruise target speed" values they gate (see groupSectionControls' own cruiseOverride handling). */
  extras?: Control[];
  /** Same idea as extras, but rendered above the family grid instead of below it - currently just the "eMTB assist based on" radio, which only ever matters while eMTB assist is the active mode, so it's grouped into the same card as the values it shapes rather than sitting elsewhere on the page implying it's independent of them (see groupSectionControls' own eMTB handling). */
  leadingExtras?: Control[];
}

/**
 * Extra per-cell disable condition applied on top of a group's shared
 * `enabled` (from the first member's dependsOn) - NOT via each field's own
 * `dependsOn`, because dependsOnKey() (below) uses dependsOn's source text
 * as the family-grouping identity check; giving walkSpeed1-4 their own
 * per-level dependsOn would split "Walk assist speed" into multiple stray
 * cards/rows instead of one 4-cell card. This lets each of ECO/TOUR/SPORT/
 * TURBO grey out individually - once its own Cruise override is on -
 * without disturbing the shared family identity every other cell relies on.
 */
const EXTRA_CELL_ENABLED: Record<string, (values: FieldValues) => boolean> = {
  walkSpeed1: (v) => v.cruiseOverrideEco !== true,
  walkSpeed2: (v) => v.cruiseOverrideTour !== true,
  walkSpeed3: (v) => v.cruiseOverrideSport !== true,
  walkSpeed4: (v) => v.cruiseOverrideTurbo !== true,
};

/** ECO/TOUR/SPORT/TURBO in display order, paired with the override toggle that redirects that level's walk-assist button to Cruise control - shared by the per-cell "Overridden by Cruise control" badge (renderControlGroup) and the one consolidated warning below the four toggles (cruiseOverrideWarning). */
const CRUISE_OVERRIDE_LEVELS: { key: keyof FieldValues; label: string }[] = [
  { key: "cruiseOverrideEco", label: "ECO" },
  { key: "cruiseOverrideTour", label: "TOUR" },
  { key: "cruiseOverrideSport", label: "SPORT" },
  { key: "cruiseOverrideTurbo", label: "TURBO" },
];

function listWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * One consolidated warning for the "Cruise target speed" card's four
 * override toggles, shown once below all of them - replaces what used to be
 * an almost-identical per-checkbox hint repeated once per active level (see
 * cruiseOverrideEco/Tour/Sport/Turbo in ui-model.ts, which no longer carry a
 * `hint` of their own). Returns null (renders nothing) if no override is on.
 */
function cruiseOverrideWarning(values: FieldValues): string | null {
  const active = CRUISE_OVERRIDE_LEVELS.filter((l) => values[l.key] === true).map((l) => l.label);
  if (active.length === 0) return null;
  const plural = active.length > 1;
  return `Holding the walk-assist button at ${plural ? "any of " : ""}${listWithAnd(active)} now triggers real Cruise control (a powered speed-hold) there instead of plain Walk assist - same button, two very different behaviors for ${plural ? "those levels" : "that level"}. Won't engage until you're above "Cruise threshold speed" below (set that to 0 for standstill use).${values.cruiseWithoutPedaling === true ? "" : ' "Cruise without pedaling" is currently off, so this needs active pedaling to engage.'}${values.walkAssistEnabled === true ? "" : ' "Walk assist enabled" above is off, but that has no effect on overridden levels - they still work regardless.'}${values.startupAssistEnabled === true ? ' "Startup assist enabled" (Startup boost & smooth start page) is also on - firmware checks it first on every walk-assist-button press, so whenever the lights are on it claims the button instead and this override doesn\'t engage at all; only takes effect with the lights off.' : ""}`;
}

/** "Cell volts: full" and "Cell volts: empty" apply regardless of display type, while everything between them is two mutually-exclusive threshold runs (4-bar VLCD6/XH18, 6-bar VLCD5/DZ40) already individually dependsOn-gated - one 3-column card (full | thresholds | empty) instead of a standalone row plus two separate repeater cards, since it's really one setting (the battery gauge's voltage curve) split across display-type variants. */
export interface CellVoltsGroup {
  kind: "cellVolts";
  full: Control;
  mid: Control[];
  empty: Control;
}
export type RenderItem = Control | FieldGroup | CellVoltsGroup;

const CELL_VOLTS_FULL_KEY = "liIonCellVoltsFull";
const CELL_VOLTS_EMPTY_KEY = "liIonCellVoltsEmpty";

/** "Display data N delay (0.1s)" has its digit in the middle of the label ("...data 1 delay..."), not trailing - repeaterTag() below only detects a trailing "N"/"N/M", so this family of 6 has always rendered as 6 separate full-width rows instead of the same kind of framed card every other numbered family gets. Grouped explicitly here rather than by relabeling, since relabeling would either lose the "(0.1s)" unit hint or (if kept trailing) get misparsed as the tag itself. */
const DELAY_DISPLAY_DATA_KEYS = [1, 2, 3, 4, 5, 6].map((n) => `delayDisplayData${n}`);

/** Source text of a control's dependsOn, used as a cheap identity check so e.g. the 4-bar and 6-bar "Cell volts" runs (different dependsOn) don't get merged into one group despite sharing a label prefix. */
function dependsOnKey(c: Control): string {
  return c.dependsOn ? c.dependsOn.toString() : "";
}

function repeaterTag(label: string): { stem: string; tag: string } | null {
  const m = label.match(/^(.*?)\s*[:-]?\s*(\d+(?:\/\d+)?)(\s*\([A-Za-z0-9]+\))?$/);
  if (!m) return null;
  const stem = m[1].replace(/[:-]\s*$/, "").trim();
  if (!stem) return null;
  const tag = m[3] ? m[3].replace(/[()]/g, "").trim() : m[2];
  return { stem, tag };
}

export function groupSectionControls(sectionControls: Control[]): RenderItem[] {
  const items: RenderItem[] = [];
  let i = 0;
  while (i < sectionControls.length) {
    const c = sectionControls[i];

    if (c.kind !== "radio" && c.key === CELL_VOLTS_FULL_KEY) {
      const emptyIdx = sectionControls.findIndex((x) => x.kind !== "radio" && x.key === CELL_VOLTS_EMPTY_KEY);
      if (emptyIdx > i) {
        items.push({
          kind: "cellVolts",
          full: c,
          mid: sectionControls.slice(i + 1, emptyIdx),
          empty: sectionControls[emptyIdx],
        });
        i = emptyIdx + 1;
        continue;
      }
    }

    if (c.kind !== "radio" && c.key === DELAY_DISPLAY_DATA_KEYS[0]) {
      const slice = sectionControls.slice(i, i + DELAY_DISPLAY_DATA_KEYS.length);
      const isContiguous =
        slice.length === DELAY_DISPLAY_DATA_KEYS.length &&
        slice.every((x, idx) => x.kind !== "radio" && x.key === DELAY_DISPLAY_DATA_KEYS[idx]);
      if (isContiguous) {
        items.push({
          kind: "group",
          stem: "Display data delay (0.1s)",
          members: slice.map((control, idx) => ({ control, tag: String(idx + 1) })),
        });
        i += DELAY_DISPLAY_DATA_KEYS.length;
        continue;
      }
    }

    const parsed =
      c.kind === "number" || c.kind === "checkbox" || c.kind === "text" || c.kind === "intSelect"
        ? repeaterTag(c.label)
        : null;
    if (parsed) {
      const members = [{ control: c, tag: parsed.tag }];
      let j = i + 1;
      while (j < sectionControls.length) {
        const c2 = sectionControls[j];
        const parsed2 = c2.kind === c.kind ? repeaterTag(c2.label) : null;
        if (parsed2 && parsed2.stem === parsed.stem && dependsOnKey(c2) === dependsOnKey(c)) {
          members.push({ control: c2, tag: parsed2.tag });
          j++;
        } else {
          break;
        }
      }
      if (members.length >= 2) {
        // "Cruise target speed"'s four walk-assist-override toggles (one per
        // level) are kept adjacent to it in raw order (see ui-model.ts's
        // moveBefore calls just for this) specifically so they land here and
        // can render inside the same card, right under the values they gate,
        // instead of as separate rows elsewhere on the page.
        let extras: Control[] | undefined;
        if (parsed.stem === "Cruise target speed") {
          const overrideKeys = [
            "cruiseOverrideEco",
            "cruiseOverrideTour",
            "cruiseOverrideSport",
            "cruiseOverrideTurbo",
          ];
          const slice = sectionControls.slice(j, j + overrideKeys.length);
          const isContiguous =
            slice.length === overrideKeys.length &&
            slice.every((x, idx) => x.kind === "checkbox" && x.key === overrideKeys[idx]);
          if (isContiguous) {
            extras = slice;
            j += overrideKeys.length;
          }
        }
        items.push({ kind: "group", stem: parsed.stem, members, extras });
        i = j;
        continue;
      }
    }
    items.push(c);
    i++;
  }

  // "eMTB assist based on" only ever matters while eMTB assist is the active
  // mode, so it's folded into the eMTB assist level card as a leading row
  // instead of rendering as an unrelated-looking standalone radio elsewhere
  // on the page. ui-model.ts's own moveBefore call keeps it immediately
  // *before* the family in raw order (see that call's own comment - a prior,
  // independent decision this reuses rather than re-deriving), so it always
  // lands as the item right before the "eMTB assist level" group above -
  // pulled back out and reattached here rather than detected inside the loop
  // above, since by the time that loop reaches the family, the standalone
  // radio ahead of it has already been pushed as its own item.
  const emtbIdx = items.findIndex((it) => it.kind === "group" && it.stem === "eMTB assist level");
  if (emtbIdx > 0) {
    const prev = items[emtbIdx - 1];
    if (prev.kind === "radio" && prev.groupKeys.includes("eMtbPower")) {
      (items[emtbIdx] as FieldGroup).leadingExtras = [prev];
      items.splice(emtbIdx - 1, 1);
    }
  }

  return items;
}

/** Compact input for one cell of a repeater card - same value/change semantics as renderControl's number/text/checkbox branches, always re-rendering on change (a group is small enough that this doesn't cost anything, unlike a 32-field section). */
function renderGroupCellInput(c: Control, enabled: boolean, app: HTMLElement): HTMLElement {
  if (c.kind === "checkbox") {
    const input = el("input", { type: "checkbox", checked: state.values[c.key] === true, disabled: !enabled });
    input.addEventListener("change", () => {
      state.values[c.key] = input.checked;
      persistSession();
      renderApp(app);
    });
    return input;
  }
  if (c.kind === "intSelect") {
    const select = el(
      "select",
      { disabled: !enabled },
      c.options.map((o) => el("option", { value: String(o.value), text: o.label })),
    );
    select.value = String(state.values[c.key] ?? c.options[0].value);
    select.addEventListener("change", () => {
      state.values[c.key] = Number(select.value);
      persistSession();
      renderApp(app);
    });
    return select;
  }
  // Only "checkbox" | "number" | "text" | "intSelect" ever reach here - see
  // the kind filter in groupSectionControls - but the Control union needs a
  // runtime narrow too since TS can't see that constraint through FieldGroup.
  if (c.kind !== "number" && c.kind !== "text") throw new Error(`unexpected control kind in group: ${c.kind}`);
  const speedField = c.kind === "number" ? c.speedField : undefined;
  const displayValue =
    speedField === "kmh"
      ? speedRawToDisplay(Number(state.values[c.key] ?? 0), state.values)
      : (state.values[c.key] ?? "");
  const error = rangeError(c);
  const input = el("input", {
    type: c.kind === "number" ? "number" : "text",
    value: String(displayValue),
    disabled: !enabled,
    className: error ? "field-invalid-input" : "",
    title: error ?? "",
  });
  input.addEventListener("change", () => {
    if (speedField === "kmh") {
      state.values[c.key] = speedDisplayToRaw(Number(input.value), state.values);
    } else {
      state.values[c.key] = input.value === "" ? "" : c.kind === "number" ? Number(input.value) : input.value;
    }
    persistSession();
    renderApp(app);
  });
  if (speedField === "kmhX10") {
    const mphHint = el("span", { className: "field-mph-hint", text: `≈ ${kmhX10ToMph(Number(input.value))} mph` });
    input.addEventListener("input", () => {
      mphHint.textContent = `≈ ${kmhX10ToMph(Number(input.value))} mph`;
    });
    return el("div", { className: "field-group-cell-input-wrap" }, [input, mphHint]);
  }
  if (speedField === "kmh" && speedUnitSuffix(state.values) === "mph") {
    // Reverse case - see renderControl()'s matching branch for why this
    // shows the exact speedDisplayToRaw result, not an approximation.
    const kmhHint = el("span", {
      className: "field-mph-hint",
      text: `≈ ${speedDisplayToRaw(Number(input.value), state.values)} km/h`,
    });
    input.addEventListener("input", () => {
      kmhHint.textContent = `≈ ${speedDisplayToRaw(Number(input.value), state.values)} km/h`;
    });
    return el("div", { className: "field-group-cell-input-wrap" }, [input, kmhHint]);
  }
  if (speedField === "kmh") {
    // Speed units is km/h (or unset) - see renderControl()'s matching branch.
    const mphHint = el("span", { className: "field-mph-hint", text: `≈ ${kmhToMph(Number(input.value))} mph` });
    input.addEventListener("input", () => {
      mphHint.textContent = `≈ ${kmhToMph(Number(input.value))} mph`;
    });
    return el("div", { className: "field-group-cell-input-wrap" }, [input, mphHint]);
  }
  return input;
}

export function renderControlGroup(group: FieldGroup, app: HTMLElement): HTMLElement {
  const first = group.members[0].control;
  const enabled = controlEnabled(first);
  const required = group.members.some((m) => m.control.required);

  // All members of a detected family share the same speedField (verified
  // empirically - e.g. every "Cruise target speed N" is "kmh", every "Walk
  // assist speed N" is "kmhX10") - shown once on the group header instead
  // of repeated per-cell, same info as the singleton-field label suffix.
  const speedField = first.kind === "number" ? first.speedField : undefined;
  const stemSuffix =
    speedField === "kmh"
      ? ` (${speedUnitSuffix(state.values)})`
      : speedField === "kmhX10"
        ? " (km/h x10, always - not affected by Speed units)"
        : "";

  const headerChildren: (Node | null)[] = [
    el("span", { text: `${group.stem}${stemSuffix}`, className: required ? "required" : "" }),
  ];
  const tooltip = group.members.find((m) => m.control.tooltip)?.control.tooltip;
  let help: HTMLElement | null = null;
  if (tooltip) {
    help = el("div", { className: "field-help hidden" });
    for (const node of formatHelpText(tooltip)) help.appendChild(node);
    const toggle = el("button", { type: "button", className: "help-toggle", text: "?", title: "Show/hide help" });
    toggle.addEventListener("click", () => {
      const nowHidden = help!.classList.toggle("hidden");
      toggle.setAttribute("aria-expanded", String(!nowHidden));
    });
    headerChildren.push(toggle);
  }

  // intSelect members (e.g. "Display data 1-6", "Lights configuration 1-3")
  // get long, meaningful option text that a horizontal multi-column layout
  // would truncate - stack those one per line instead so the full selected
  // label is always visible, unlike the compact number/checkbox/text grid.
  const stacked = first.kind === "intSelect";
  const assist5Label = stacked ? undefined : STEM_TO_ASSIST5_LABEL[group.stem];
  const l5 = assist5Label ? assistLevel5ChartField(assist5Label) : null;

  const row = el("div", { className: stacked ? "field-group-row field-group-row-stacked" : "field-group-row" });
  // The chart above (assistVisuals below) always renders its bars as fixed
  // equal-width columns (.assist-chart-bars), whether or not an L5 bar is
  // present - this row needs the matching layout whenever that chart
  // exists (assist5Label truthy), not only when L5 itself is active, or
  // the cells drift out of alignment with their bars as soon as Assist
  // level 5 mode is set back to Disabled.
  if (assist5Label) row.classList.add("field-group-row-chart");

  const cells = group.members.map(({ control, tag }) => {
    // Radio controls never reach here (repeaterTag's group-detection above
    // only ever collects number/checkbox/text/intSelect members).
    const extraCheck = control.kind !== "radio" ? EXTRA_CELL_ENABLED[control.key] : undefined;
    // Overridden (cruise-override on for this specific level) is tracked
    // separately from the card's shared `enabled` - it's true real-world
    // information (that button now does something else) even when the card
    // itself is greyed out for an unrelated reason (walkAssistEnabled off),
    // since the override works independently of that setting. See
    // cruiseOverrideWarning's own doc comment.
    const overridden = extraCheck ? !extraCheck(state.values) : false;
    const cellEnabled = enabled && !overridden;
    const cellClasses = ["field-group-cell"];
    if (stacked) cellClasses.push("field-group-cell-stacked");
    if (!cellEnabled) cellClasses.push("field-disabled");
    const changed = controlChanged(control);
    if (changed) cellClasses.push("field-changed");
    return el("div", { className: cellClasses.join(" ") }, [
      el("span", { className: "field-group-tag", text: tag }),
      renderGroupCellInput(control, cellEnabled, app),
      overridden ? el("span", { className: "field-group-cell-override-badge", text: "Overridden by Cruise" }) : null,
      changed ? renderRevertButton(control, app) : null,
    ]);
  });

  // Reserves a same-width, non-interactive column where the chart's L5 bar
  // sits (see renderAssistCurveChart) - level 5's actual value lives in the
  // Assist level 5 % field elsewhere on this page, not a per-family input,
  // but without this placeholder the 4 real cells below would be narrower
  // than the 4 real bars above (which share their row with a 5th, L5, bar)
  // and the columns would drift out of alignment.
  if (l5) {
    // Shows the live computed value in place, same column as the chart's L5
    // bar above it - not an editable input (level 5's real source field is
    // Assist level 5 %, elsewhere on this page), but a bare number reads as
    // "this column's actual value" the same way the real cells' <input>s do,
    // which a text explanation of where it comes from didn't.
    const valueSpan = el("span", { className: "field-group-cell-placeholder-value" });
    const updatePlaceholderValue = () => {
      const percent = Number(state.values.assistLevel5Percent ?? 0);
      const { wrapped, overflowed } = assistLevel5Result(l5.field, percent);
      valueSpan.textContent = String(assistLevel5DisplayValue(l5.field, wrapped));
      valueSpan.classList.toggle("field-group-cell-placeholder-value-warn", overflowed);
    };
    updatePlaceholderValue();
    assistChartUpdaters.push(updatePlaceholderValue);

    const placeholder = el("div", { className: "field-group-cell field-group-cell-placeholder" }, [
      el("span", { className: "field-group-tag", text: "L5" }),
      valueSpan,
    ]);
    if (l5.position === "before") cells.unshift(placeholder);
    else cells.push(placeholder);
  }
  for (const cell of cells) row.appendChild(cell);

  const assistVisuals = stacked ? null : renderAssistCurveChart(group.stem, group.members);
  if (assistVisuals) {
    headerChildren[0]!.textContent += ` (max: ${assistVisuals.rawMax})`;
  }

  const startupNote = stacked ? null : startupAssistNote(group.stem);
  if (startupNote) {
    headerChildren.push(el("span", { className: "field-group-startup-badge", text: startupNote }));
  }
  // DZ40 only (see control-types.ts's dz40AssistFamilyDead doc comment) -
  // never true for a stacked (non-assist) family, same guard startupNote
  // above already uses. "Lights configuration" is DZ40-dead too, but for a
  // simpler reason (unconditional, not "whichever mode isn't active") - see
  // sections/lights.ts's own dz40LightsConfigDead comment - so it gets its
  // own message rather than reusing the assist-mode one.
  // Suppressed under Pro mode, same reasoning as riding-modes-page.ts's own
  // deadCardNote gating: the fields themselves are already editable there
  // (see `enabled` above, via controlEnabled()), so this note would just
  // contradict what the card actually lets you do.
  const dz40LightsDead =
    state.proMode !== true && stacked && group.stem === "Lights configuration" && state.values.displayTypeDZ40 === true;
  const dz40Dead =
    dz40LightsDead || (state.proMode !== true && !stacked && dz40AssistFamilyDead(state.values, group.stem));
  const dz40Note = dz40LightsDead ? DZ40_LIGHTS_CONFIG_DEAD_NOTE : DZ40_ASSIST_DEAD_NOTE;

  // Everything that dims together when the card is disabled lives in
  // cardBody, a separate wrapper from the outer card - deliberately *not*
  // one combined element, so the dz40Dead note below (appended to card, not
  // cardBody) stays fully visible even while the rest of the card dims. Same
  // reasoning/pattern as render/control.ts's fieldDiv/fieldBody split for
  // Control.noteBefore.
  const cardBodyClasses: string[] = [];
  if (!enabled) cardBodyClasses.push("field-disabled");
  const cardBody = el("div", { className: cardBodyClasses.join(" ") }, [assistVisuals?.chart ?? null, row]);
  if (group.leadingExtras) {
    for (const extra of [...group.leadingExtras].reverse()) {
      const extraRow = renderControl(extra, app);
      extraRow.classList.add("field-group-extra");
      cardBody.prepend(extraRow);
    }
  }

  const cardClasses = ["field-group"];
  if (startupNote) cardClasses.push("field-group-startup");
  const card = el("div", { className: cardClasses.join(" ") }, [
    el("div", { className: "field-group-header" }, headerChildren),
    dz40Dead ? el("div", { className: "field-note-box" }, [icon("infoCircle"), el("span", { text: dz40Note })]) : null,
    cardBody,
  ]);
  if (help) cardBody.append(help);
  // Extra checkbox controls (currently just the four Cruise-overrides-walk-
  // assist toggles, one per level) rendered as full ordinary field rows, wrapped in their
  // own class only for the card-internal spacing/divider - everything else
  // (hint, tooltip, dirty state, revert button) comes from renderControl()
  // unmodified, same as if this were a standalone page row.
  if (group.extras) {
    for (const extra of group.extras) {
      const extraRow = renderControl(extra, app);
      extraRow.classList.add("field-group-extra");
      cardBody.append(extraRow);
    }
    const overrideWarning = cruiseOverrideWarning(state.values);
    if (overrideWarning) {
      cardBody.append(
        el("div", { className: "field-group-note" }, [icon("infoCircle"), el("span", { text: overrideWarning })]),
      );
    }
  }
  return card;
}

/**
 * Hand-authored, not pulled from any single field's tooltip (the way
 * renderControlGroup does for an auto-detected family) - Full/Empty are two
 * different fields with two different narrow tooltips, and this card is
 * meant to explain the whole full-to-empty curve as one concept, including
 * what "full"/"empty" actually mean for the gauge and how to pick sane
 * values, which no individual field's tooltip covers on its own.
 */
const CELL_VOLTS_HELP =
  "Sets the per-cell voltage curve the display's battery gauge follows, laid out left to right the same way the bar count actually climbs on a real display: Empty, then the Bar thresholds column (where each bar in between lights up), then Full. All values are per cell (pack voltage divided by cell count), read at rest under a normal riding load, not a no-load or peak-charge reading. Empty: per-cell voltage for the bottom state (0 bars) - a display threshold only, not the same as Battery low-voltage cutoff (the firmware's real current-limiting safety threshold, set separately in this section). Full: per-cell voltage for the top state (all bars). Typical numbers: most 18650/21700 Li-ion cells peak around 4.20V/cell fresh off the charger at rest, but sag under load, so a common Full setting is 4.00-4.10V/cell rather than the theoretical peak. Empty is commonly set around 3.0-3.2V/cell at rest under load - well above the cell's true damage threshold (roughly 2.5V) but low enough that the gauge doesn't hit 0 bars while real range is still left. Recommendation: those are starting points, not a substitute for your own pack - measure its real per-cell voltage shortly after a full charge under normal riding load, and set Full a little below that reading so the top bar doesn't pin and then drop the moment you start pedaling.";

/**
 * "Cell volts" 3-column card: Full charge | 4-bar/6-bar thresholds | Empty.
 * Unlike renderControlGroup, no single "enabled" applies to the whole
 * card - Full/Empty always apply, while each threshold row is individually
 * dependsOn-gated on the current Display type (see CellVoltsGroup's doc
 * comment) - so each row greys out on its own instead of the whole card.
 */
export function renderCellVoltsCard(group: CellVoltsGroup, app: HTMLElement): HTMLElement {
  const tooltip = CELL_VOLTS_HELP;
  const headerChildren: (Node | null)[] = [el("span", { text: "Cell volts (per-cell battery-gauge thresholds)" })];
  let help: HTMLElement | null = null;
  if (tooltip) {
    help = el("div", { className: "field-help hidden" });
    for (const node of formatHelpText(tooltip)) help.appendChild(node);
    const toggle = el("button", { type: "button", className: "help-toggle", text: "?", title: "Show/hide help" });
    toggle.addEventListener("click", () => {
      const nowHidden = help!.classList.toggle("hidden");
      toggle.setAttribute("aria-expanded", String(!nowHidden));
    });
    headerChildren.push(toggle);
  }

  const singleColumn = (headerText: string, control: Control) => {
    const enabled = controlEnabled(control);
    const changed = controlChanged(control);
    const rowClasses = ["cell-volts-row"];
    if (!enabled) rowClasses.push("field-disabled");
    if (changed) rowClasses.push("field-changed");
    return el("div", { className: "cell-volts-col" }, [
      el("div", { className: "cell-volts-col-header", text: headerText }),
      el("div", { className: rowClasses.join(" ") }, [
        renderGroupCellInput(control, enabled, app),
        changed ? renderRevertButton(control, app) : null,
      ]),
    ]);
  };

  // The mid thresholds are two mutually-exclusive display-type families
  // (4-bar VLCD6/XH18, 6-bar VLCD5/DZ40) already individually dependsOn-gated
  // - split them back into those families (by comparing dependsOn source
  // text, same identity check groupSectionControls uses) and lay each family
  // out as its own horizontal row, instead of one long vertical list.
  const families: Control[][] = [];
  for (const control of group.mid) {
    const key = dependsOnKey(control);
    const last = families.at(-1);
    if (last && dependsOnKey(last[0]) === key) last.push(control);
    else families.push([control]);
  }

  const subrow = (familyControls: Control[]) => {
    const enabled = controlEnabled(familyControls[0]);
    const rowClasses = ["field-group-row"];
    if (!enabled) rowClasses.push("field-disabled");
    return el(
      "div",
      { className: rowClasses.join(" ") },
      // Raw order is highest-voltage-first (N-1/N down to 1/N) - fine under
      // the old Full-first layout where that continued descending left to
      // right, but backwards now that Empty leads and Full trails (see the
      // grid assembly below): reverse so bar number/voltage both climb left
      // to right, 1/N through (N-1)/N, matching Empty -> Full.
      [...familyControls].reverse().map((control) => {
        const cellClasses = ["field-group-cell"];
        const changed = controlChanged(control);
        if (changed) cellClasses.push("field-changed");
        return el("div", { className: cellClasses.join(" ") }, [
          el("span", { className: "field-group-tag", text: control.label.replace(/^Cell volts:\s*/, "") }),
          renderGroupCellInput(control, enabled, app),
          changed ? renderRevertButton(control, app) : null,
        ]);
      }),
    );
  };

  const midColumn = el("div", { className: "cell-volts-col cell-volts-col-mid" }, [
    el("div", { className: "cell-volts-col-header", text: "Bar thresholds (per segment, by display type)" }),
    ...families.map(subrow),
  ]);

  // Empty | thresholds (ascending) | Full, left to right - matches how the
  // bar count actually reads on a real display (0 bars at empty, climbing
  // to all bars at full), not the Full-first order this card used before.
  const grid = el("div", { className: "cell-volts-grid" }, [
    singleColumn("Empty", group.empty),
    midColumn,
    singleColumn("Full", group.full),
  ]);

  const card = el("div", { className: "field-group" }, [
    el("div", { className: "field-group-header" }, headerChildren),
    grid,
  ]);
  if (help) card.append(help);
  return card;
}
