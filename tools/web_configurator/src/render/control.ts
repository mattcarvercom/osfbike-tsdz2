import "./control.css";
import { selectedRadioOption, type Control } from "../ui-model.ts";
import {
  state,
  controls,
  controlChanged,
  controlEnabled,
  revertControl,
  persistSession,
  isDirty,
  assistChartUpdaters,
} from "../app-state.ts";
import {
  el,
  icon,
  formatHelpText,
  renderToggleGroup,
  renderVisualPickerDropdown,
  TOGGLE_GROUP_MAX_OPTIONS,
  type VisualPickerOption,
} from "../dom.ts";
import {
  speedUnitSuffix,
  speedRawToDisplay,
  speedDisplayToRaw,
  kmhX10ToMph,
  kmhToMph,
  mmToInches,
} from "../speed-units.ts";
import {
  MIDDLE_ANGLE_ADJ,
  MIDDLE_OFFSET_ADJ,
  MIDDLE_RANGE_ADJ,
  decodeSignedOffset,
  encodeSignedOffset,
} from "../config-h-generator.ts";
import { assistLevel5ActiveFields, assistLevel5OverflowError, updateAssistLevel5Badge } from "../assist-level5.ts";
import { renderApp } from "./app-shell.ts";

const MIDDLES: Record<string, number> = {
  torqueOffsetAdjRaw: MIDDLE_OFFSET_ADJ,
  torqueRangeAdjRaw: MIDDLE_RANGE_ADJ,
  torqueAngleAdjRaw: MIDDLE_ANGLE_ADJ,
};

/**
 * Short "out of range" message if a number/signedOffset control's current
 * *raw* stored value exceeds what the firmware can actually hold (see
 * NumberControl.rawMax / WIDE_RAW_FIELDS in ui-model.ts) - null if it's
 * fine. Always checks the raw value, never the unit-converted display value
 * shown for "kmh" speed fields, so it's correct regardless of which speed
 * unit is currently selected. Also covers assistLevel5Percent's cross-field
 * After Turbo overflow (see assistLevel5OverflowError) - otherwise this only
 * catches storage-width truncation (e.g. 300 silently becoming 44 in a
 * uint8_t), not "sane" business-logic ranges like percentages or cell
 * counts.
 */
export function rangeError(c: Control): string | null {
  if (c.kind === "number") {
    const raw = Number(state.values[c.key] ?? 0);
    if (raw < 0 || raw > c.rawMax)
      return `Out of range - firmware stores this as 0-${c.rawMax}; this value won't build/flash correctly.`;
    if (c.key === "assistLevel5Percent") return assistLevel5OverflowError(raw);
    return null;
  }
  if (c.kind === "signedOffset") {
    const middle = MIDDLES[c.key] ?? 20;
    const raw = Number(state.values[c.key] ?? middle);
    if (raw < 0 || raw > 255) {
      return `Out of range - firmware stores this as 0-255 (${0 - middle} to ${255 - middle} as the signed value shown here); this value won't build/flash correctly.`;
    }
    return null;
  }
  return null;
}

/**
 * Builds the label + optional "?" help-toggle button shared by every
 * control kind. Checkbox rows use a real <label> (the checkbox gets
 * prepended into it by the caller) so native label-forwarding lets clicking
 * anywhere in the row toggle the checkbox - the desired behavior there.
 * Every other kind uses a plain <div>: a <label> with only the "?" button
 * as a labelable descendant would forward ANY click inside its flex:1 box
 * - including blank space between the label text and the input - to that
 * button, silently popping help open/closed. With a <div>, help only
 * toggles from an explicit click on the label text itself or the button,
 * never the surrounding whitespace.
 */
function renderLabel(c: Control, labelText: string): { label: HTMLElement; help: HTMLElement | null } {
  const labelSpan = el("span", { text: labelText, className: c.required ? "required" : "" });
  const wrapperTag = c.kind === "checkbox" ? "label" : "div";
  let help: HTMLElement | null = null;

  if (c.tooltip) {
    help = el("div", { className: "field-help hidden" });
    for (const node of formatHelpText(c.tooltip)) help.appendChild(node);
    const toggle = el("button", {
      type: "button",
      className: "help-toggle",
      text: "?",
      title: "Show/hide help",
    });
    toggle.setAttribute("aria-expanded", "false");
    const toggleHelp = () => {
      const nowHidden = help!.classList.toggle("hidden");
      toggle.setAttribute("aria-expanded", String(!nowHidden));
    };
    toggle.addEventListener("click", toggleHelp);
    if (wrapperTag === "div") {
      labelSpan.classList.add("field-label-text-clickable");
      labelSpan.addEventListener("click", toggleHelp);
    }
    return { label: el(wrapperTag, { className: "field-label" }, [labelSpan, toggle]), help };
  }

  return { label: el(wrapperTag, { className: "field-label" }, [labelSpan]), help };
}

/** Small icon-only button shown next to any field that's currently changed from baseline - reverts just that one control (not the whole section/form) back to its last saved/loaded/reset value. Always triggers a full renderApp(), even next to number/text inputs that otherwise avoid one - a revert is a discrete, infrequent action, not a keystroke. */
export function renderRevertButton(c: Control, app: HTMLElement): HTMLElement {
  const btn = el(
    "button",
    { type: "button", className: "revert-btn", title: "Revert this field to its last saved/loaded value" },
    [icon("revert")],
  );
  btn.addEventListener("click", () => {
    revertControl(c);
    renderApp(app);
  });
  return btn;
}

/**
 * Renders one control as a `.field` wrapper (row + optional collapsible help
 * text). `app` is only needed to re-render after a change to a checkbox/
 * radio/intSelect - those are exactly the control kinds other fields'
 * `dependsOn` can reference, so their disabled state must recompute live.
 * number/text/signedOffset inputs skip this (keeps typing responsive) since
 * no dependsOn in ui-model.ts currently keys off one of them.
 */
export function renderControl(c: Control, app: HTMLElement): HTMLElement {
  const enabled = controlEnabled(c);
  const row = el("div", { className: "field-row" });
  const speedField = c.kind === "number" ? c.speedField : undefined;
  const distanceField = c.kind === "number" ? c.distanceField : undefined;
  const labelText =
    speedField === "kmh"
      ? `${c.label} (${speedUnitSuffix(state.values)})`
      : speedField === "kmhX10"
        ? `${c.label} (km/h x10, always - not affected by Speed units)`
        : c.label;
  const { label, help } = renderLabel(c, labelText);

  const initialError = rangeError(c);
  const fieldDiv = el("div", { className: "field" });
  /** Carries field-disabled/-changed/-invalid, everything from `row` down - deliberately *not* the outer fieldDiv, so noteBeforeDiv below (appended as fieldDiv's own direct child, ahead of this) stays fully visible/prominent even when this field itself is dependsOn-disabled and dimmed. A noteBefore exists specifically to flag context the reader needs before a disabled run of fields (e.g. DZ40's "everything from here down is disabled") - dimming it along with the fields it explains would bury the one thing that's supposed to stand out. */
  const bodyClasses = ["field-body"];
  if (!enabled) bodyClasses.push("field-disabled");
  if (controlChanged(c)) bodyClasses.push("field-changed");
  if (initialError) bodyClasses.push("field-invalid");
  const fieldBody = el("div", { className: bodyClasses.join(" ") });
  const errorDiv = el("div", { className: `field-error${initialError ? "" : " hidden"}`, text: initialError ?? "" });
  /** Advisory note, not an error (see Control.hint's own doc comment) - recomputed on every renderControl() call and also inside markChanged() below, since a hint (e.g. cruiseThresholdSpeed's safetyWarning) can depend on the very number/text field it's attached to, whose own edits only go through markChanged()'s fast path, not a full renderApp(). Icon-prefixed (info) same as every other advisory box in the app - see dom.ts's icon() doc comment on the info/exclamation-circle pair. */
  const initialHint = c.hint ? c.hint(state.values) : null;
  const hintText = el("span", { text: initialHint ?? "" });
  const hintDiv = el("div", { className: `field-hint${initialHint ? "" : " hidden"}` }, [icon("infoCircle"), hintText]);
  /** Same as hintDiv, but for a genuine physical-safety concern (see Control.safetyWarning) - its own red-bordered box so it doesn't read as an ordinary advisory. */
  const initialSafetyWarning = c.safetyWarning ? c.safetyWarning(state.values) : null;
  const safetyText = el("span", { text: initialSafetyWarning ?? "" });
  const safetyDiv = el("div", { className: `field-safety-warning${initialSafetyWarning ? "" : " hidden"}` }, [
    icon("exclamationCircle"),
    safetyText,
  ]);
  /** Context needed *before* reaching this field, not after (see Control.noteBefore's own doc comment) - e.g. "everything past this point is disabled" belongs above the first disabled field, not below the last enabled one. Rendered at the very top of fieldDiv, ahead of the row itself. */
  const initialNoteBefore = c.noteBefore ? c.noteBefore(state.values) : null;
  const noteBeforeText = el("span", { text: initialNoteBefore ?? "" });
  const noteBeforeDiv = el("div", { className: `field-note-box${initialNoteBefore ? "" : " hidden"}` }, [
    icon("infoCircle"),
    noteBeforeText,
  ]);
  /** Always in the DOM, visibility toggled via "hidden" rather than conditionally appended - number/text/signedOffset edits only call markChanged() below (no full renderApp(), see its own comment), so the button has to be able to reveal itself in place instead of relying on a re-render to add it. */
  const revertBtn = renderRevertButton(c, app);
  revertBtn.classList.toggle("hidden", !controlChanged(c));
  /** For control kinds that don't trigger a full renderApp() on change (number/text/signedOffset - keeps typing responsive), update this field's own changed-state and persist the draft directly instead. Also has to reach past this field to the sidebar's per-section dot/revert-button and the topbar's "Unsaved changes" badge - those are only recomputed inside renderSidebar()/renderTopbar(), which a full renderApp() would normally refresh, so this fast path has to update them by hand instead or they'd go stale until the next unrelated full render (e.g. navigating sections). Same reasoning now applies to hintDiv/safetyDiv, added when cruiseThresholdSpeed's safetyWarning needed to react to its own live value. */
  const markChanged = () => {
    fieldBody.classList.toggle("field-changed", controlChanged(c));
    const err = rangeError(c);
    fieldBody.classList.toggle("field-invalid", err !== null);
    errorDiv.textContent = err ?? "";
    errorDiv.classList.toggle("hidden", err === null);
    if (c.hint) {
      const h = c.hint(state.values);
      hintText.textContent = h ?? "";
      hintDiv.classList.toggle("hidden", !h);
    }
    if (c.safetyWarning) {
      const w = c.safetyWarning(state.values);
      safetyText.textContent = w ?? "";
      safetyDiv.classList.toggle("hidden", !w);
    }
    if (c.noteBefore) {
      const n = c.noteBefore(state.values);
      noteBeforeText.textContent = n ?? "";
      noteBeforeDiv.classList.toggle("hidden", !n);
    }
    revertBtn.classList.toggle("hidden", !controlChanged(c));
    const sectionHasChanges = controls.filter((x) => x.section === c.section).some(controlChanged);
    app.querySelectorAll(`[data-section-id="${c.section}"]`).forEach((el) => {
      el.classList.toggle("hidden", !sectionHasChanges);
    });
    app.querySelector(".unsaved-status")?.classList.toggle("hidden", !isDirty());
    persistSession();
  };

  if (c.kind === "checkbox") {
    const input = el("input", { type: "checkbox", checked: state.values[c.key] === true, disabled: !enabled });
    input.addEventListener("change", () => {
      state.values[c.key] = input.checked;
      // All four cruise/walk-assist overrides rely on apply_cruise()'s engage
      // condition accepting a held button with no pedaling - without Cruise
      // without pedaling on, turning any override on wouldn't actually let
      // it hold speed hands/feet-off. Auto-enable it as a convenience; the
      // field's own hint warns if the rider later turns it back off.
      if (
        input.checked &&
        (c.key === "cruiseOverrideEco" ||
          c.key === "cruiseOverrideTour" ||
          c.key === "cruiseOverrideSport" ||
          c.key === "cruiseOverrideTurbo")
      ) {
        state.values.cruiseWithoutPedaling = true;
      }
      persistSession();
      renderApp(app);
    });
    label.prepend(input);
    row.appendChild(label);
  } else if (c.kind === "number" && c.sliderRange) {
    const { min, max, step = 1 } = c.sliderRange;
    const mark = c.recommendedValue ? c.recommendedValue(state.values) : null;
    const snapDistance = step * 2;
    const wrap = el("div", { className: "field-slider-wrap" });
    const track = el("div", { className: "field-slider-track" });
    const range = el("input", {
      type: "range",
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(state.values[c.key] ?? min),
      disabled: !enabled,
      className: "field-slider",
    });
    const number = el("input", {
      type: "number",
      value: String(state.values[c.key] ?? min),
      disabled: !enabled,
      className: "field-slider-number",
    });
    // commit=false skips markChanged() - used for the range thumb's own
    // "input" event (fires continuously while dragging, many times per
    // drag). markChanged() shows the revert button, which sits in this same
    // flex row and takes zero space while hidden - the instant it appears
    // mid-drag, the row reflows and the slider track shifts out from under
    // the mouse, making it nearly impossible to land on a value. Deferred to
    // the range's own "change" event below (fires once, on mouse-up/drag-
    // end) instead, while the thumb position/number box still update live
    // on every "input" so dragging itself stays visually responsive.
    const applyValue = (v: number, commit = true) => {
      state.values[c.key] = v;
      range.value = String(v);
      number.value = String(v);
      if (commit) markChanged();
    };
    range.addEventListener("input", () => {
      let v = Number(range.value);
      if (mark && Math.abs(v - mark.value) <= snapDistance) v = mark.value;
      applyValue(v, false);
    });
    range.addEventListener("change", () => markChanged());
    number.addEventListener("change", () => applyValue(Number(number.value)));
    track.appendChild(range);
    // Purely decorative boundary marking where the field's documented bound
    // stops being a hard firmware ceiling (see NumberControl.dangerAbove's
    // own doc comment) - doesn't clamp or validate anything, safetyWarning
    // (rendered above the field, see initialSafetyWarning) carries the actual
    // warning text.
    if (c.dangerAbove !== undefined && c.dangerAbove > min && c.dangerAbove < max) {
      const dangerLine = el("div", {
        className: "field-slider-danger-line",
        title: `Above ${c.dangerAbove}: verify your hardware can actually take it`,
      });
      dangerLine.style.left = `${((c.dangerAbove - min) / (max - min)) * 100}%`;
      track.appendChild(dangerLine);
    }
    wrap.append(track, number);
    if (mark) {
      const markBtn = el("button", {
        type: "button",
        className: "field-slider-mark",
        text: `${mark.label} -> ${mark.value}`,
        title: "Set to the recommended value for your current configuration",
        disabled: !enabled,
      });
      markBtn.addEventListener("click", () => applyValue(mark.value));
      wrap.append(markBtn);
      // Same fix as assistLevel5Percent's row above: label + slider + number
      // + this recommended-value button is too much for a narrow viewport to
      // hold on one line without overflowing the page horizontally.
      row.classList.add("field-row-wrap");
    }
    row.append(label, wrap);
  } else if (c.kind === "number" && c.key === "assistLevel5Percent") {
    // Bespoke branch, not the generic number path below: this field's real
    // effect is a computation involving other fields (see
    // ASSIST_LEVEL_5_ECO_FIELDS/TURBO_FIELDS), so showing just the raw
    // percent on its own tells you little - show what it actually computes
    // to, live, next to a narrower input (the badges need the room).
    const input = el("input", {
      type: "number",
      value: String(state.values[c.key] ?? 0),
      disabled: !enabled,
      className: "assist5-input",
    });
    const computed = el("div", { className: "assist5-computed" });
    const updateComputed = () => {
      computed.replaceChildren();
      const percent = Number(state.values[c.key] ?? 0);
      for (const field of assistLevel5ActiveFields()) {
        const badge = el("span", {});
        updateAssistLevel5Badge(badge, field, percent);
        computed.appendChild(badge);
      }
    };
    updateComputed();
    input.addEventListener("input", () => {
      state.values[c.key] = Number(input.value);
      updateComputed();
      markChanged();
      for (const update of assistChartUpdaters) update();
    });
    row.classList.add("field-row-wrap");
    row.append(label, computed, input);
  } else if (c.kind === "number" || c.kind === "text") {
    const displayValue =
      speedField === "kmh"
        ? speedRawToDisplay(Number(state.values[c.key] ?? 0), state.values)
        : (state.values[c.key] ?? "");
    const input = el("input", {
      type: c.kind === "number" ? "number" : "text",
      value: String(displayValue),
      disabled: !enabled,
    });
    input.addEventListener("change", () => {
      if (speedField === "kmh") {
        state.values[c.key] = speedDisplayToRaw(Number(input.value), state.values);
      } else {
        state.values[c.key] = c.kind === "number" ? Number(input.value) : input.value;
      }
      markChanged();
    });
    const presets = c.kind === "number" && c.presetValues ? c.presetValues(state.values) : [];
    if (presets.length > 0) {
      const wrap = el("div", { className: "field-slider-wrap" });
      wrap.append(input);
      for (const preset of presets) {
        const presetBtn = el("button", {
          type: "button",
          className: "field-slider-mark",
          text: `${preset.label} -> ${preset.value}`,
          title: "Set to this value",
          disabled: !enabled,
        });
        presetBtn.addEventListener("click", () => {
          state.values[c.key] = preset.value;
          input.value = String(preset.value);
          markChanged();
        });
        wrap.append(presetBtn);
      }
      row.classList.add("field-row-wrap");
      row.append(label, wrap);
    } else if (speedField === "kmhX10") {
      const mphHint = el("span", { className: "field-mph-hint", text: `≈ ${kmhX10ToMph(Number(input.value))} mph` });
      input.addEventListener("input", () => {
        mphHint.textContent = `≈ ${kmhX10ToMph(Number(input.value))} mph`;
      });
      row.append(label, input, mphHint);
    } else if (speedField === "kmh" && speedUnitSuffix(state.values) === "mph") {
      // Reverse of the kmhToMph case below: this field's raw/saved value is
      // always km/h, but it's shown/entered in mph here (Speed units is
      // miles) - show exactly what raw km/h speedDisplayToRaw would save,
      // not a decorative approximation, so this always matches config.h.
      const kmhHint = el("span", {
        className: "field-mph-hint",
        text: `≈ ${speedDisplayToRaw(Number(input.value), state.values)} km/h`,
      });
      input.addEventListener("input", () => {
        kmhHint.textContent = `≈ ${speedDisplayToRaw(Number(input.value), state.values)} km/h`;
      });
      row.append(label, input, kmhHint);
    } else if (speedField === "kmh") {
      // Speed units is km/h (or unset), so the input above already shows the
      // raw value unconverted - show the mph equivalent as a decorative
      // side-note, same as the mph-side branch above and kmhX10's hint,
      // instead of showing no conversion at all just because this field
      // happens to already be in the "native" unit.
      const mphHint = el("span", { className: "field-mph-hint", text: `≈ ${kmhToMph(Number(input.value))} mph` });
      input.addEventListener("input", () => {
        mphHint.textContent = `≈ ${kmhToMph(Number(input.value))} mph`;
      });
      row.append(label, input, mphHint);
    } else if (distanceField === "mm") {
      const inHint = el("span", { className: "field-mph-hint", text: `≈ ${mmToInches(Number(input.value))} in` });
      input.addEventListener("input", () => {
        inHint.textContent = `≈ ${mmToInches(Number(input.value))} in`;
      });
      row.append(label, input, inHint);
    } else {
      row.append(label, input);
    }
  } else if (c.kind === "signedOffset") {
    const middle = MIDDLES[c.key] ?? 20;
    const raw = Number(state.values[c.key] ?? middle);
    label.querySelector("span")!.textContent = `${c.label} (signed, 0 = default)`;
    const input = el("input", { type: "number", value: String(decodeSignedOffset(raw, middle)), disabled: !enabled });
    input.addEventListener("change", () => {
      state.values[c.key] = encodeSignedOffset(Number(input.value), middle);
      markChanged();
    });
    row.append(label, input);
  } else if (c.kind === "intSelect") {
    const currentValue = Number(state.values[c.key] ?? c.options[0].value);
    const selectedIndex = c.options.findIndex((o) => o.value === currentValue);
    if (c.options.length <= TOGGLE_GROUP_MAX_OPTIONS || c.toggleGroup) {
      row.append(
        label,
        renderToggleGroup(
          c.options.map((o) => o.label),
          selectedIndex,
          !enabled,
          (i) => {
            state.values[c.key] = c.options[i].value;
            persistSession();
            renderApp(app);
          },
        ),
      );
    } else {
      const select = el(
        "select",
        { disabled: !enabled },
        c.options.map((o) => el("option", { value: String(o.value), text: o.label })),
      );
      select.selectedIndex = Math.max(selectedIndex, 0);
      select.addEventListener("change", () => {
        state.values[c.key] = Number(select.value);
        persistSession();
        renderApp(app);
      });
      if (c.fullWidth) row.classList.add("field-row-column");
      row.append(label, select);
    }
  } else {
    // radio
    const selectedIndex = selectedRadioOption(c, state.values);
    if (c.visualPicker) {
      const pickerOptions: VisualPickerOption[] = [
        ...c.options.map((o): VisualPickerOption => ({ label: o.label, image: o.image! })),
        ...(c.unimplementedOptions ?? []).map((o): VisualPickerOption => ({
          label: o.label,
          image: o.image,
          unimplemented: true,
        })),
      ];
      row.append(
        label,
        renderVisualPickerDropdown(pickerOptions, selectedIndex, !enabled, (i) => {
          Object.assign(state.values, c.options[i].values);
          persistSession();
          renderApp(app);
        }),
      );
    } else if (c.options.length <= TOGGLE_GROUP_MAX_OPTIONS || c.toggleGroup) {
      row.append(
        label,
        renderToggleGroup(
          c.options.map((o) => o.label),
          selectedIndex,
          !enabled,
          (i) => {
            Object.assign(state.values, c.options[i].values);
            persistSession();
            renderApp(app);
          },
        ),
      );
    } else {
      const select = el(
        "select",
        { disabled: !enabled },
        c.options.map((o, i) => el("option", { value: String(i), text: o.label })),
      );
      select.selectedIndex = selectedIndex;
      select.addEventListener("change", () => {
        const opt = c.options[Number(select.value)];
        Object.assign(state.values, opt.values);
        persistSession();
        renderApp(app);
      });
      row.append(label, select);
    }
  }

  row.appendChild(revertBtn);

  fieldDiv.append(noteBeforeDiv);
  fieldBody.append(row);
  if (help) fieldBody.append(help);
  fieldBody.append(errorDiv);
  fieldBody.append(hintDiv);
  fieldBody.append(safetyDiv);
  fieldDiv.append(fieldBody);
  return fieldDiv;
}
