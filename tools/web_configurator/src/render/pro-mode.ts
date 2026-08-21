// Pro mode's own toggle - bespoke, not a generic renderControl() row, because
// it isn't backed by a raw firmware field: it never touches FieldValues,
// never gets written to config.h, never round-trips through a .ini/
// .tsdz2.json, and isn't part of isDirty()/baseline tracking (see
// app-state.ts's proMode/setProMode doc comments). Lives on the Misc page
// (see render/section-page.ts) since it's a tool-wide preference, not
// specific to any other page's subject matter.

import "./control.css"; // .field/.field-row/.field-label/.field-help/.help-toggle/.field-safety-warning - reused as-is for a consistent look
import { state, setProMode } from "../app-state.ts";
import { el, icon, formatHelpText } from "../dom.ts";
import { renderApp } from "./app-shell.ts";

const PRO_MODE_TOOLTIP =
  "\"I know what I'm doing\" override - unlocks every field this tool normally greys out based on your other settings (display type, dependent toggles, etc), instead of hiding them until their prerequisite is met. Meant for cross-referencing/copying a value from a config that doesn't match your own hardware, or deliberately setting something the UI doesn't think you should need. Doesn't change what the firmware actually does with the value - only what this tool lets you type into it.";

const PRO_MODE_WARNING =
  "PRO MODE IS ON. Every disabled-field guard in this app is bypassed - DZ40 dead-field gating, \"needs X enabled first\" gating, everything. You can now set values that don't apply to your display/hardware, contradict another setting, or that the firmware itself will silently ignore - none of the dependsOn notes elsewhere in this app stopped being true, this just lets you override them anyway. Nothing about the firmware got safer or more forgiving because this is on. Turn it back off unless you specifically know which field you're overriding and why.";

export function renderProModeToggle(app: HTMLElement): HTMLElement {
  const labelSpan = el("span", { text: "Pro / advanced mode" });
  const input = el("input", { type: "checkbox", checked: state.proMode === true });
  input.addEventListener("change", () => {
    setProMode(input.checked);
    renderApp(app);
  });

  // Same collapsed-behind-"?" pattern as every other field's tooltip (see
  // control.ts's renderLabel) - not shown by default, unlike before.
  const help = el("div", { className: "field-help hidden" });
  for (const node of formatHelpText(PRO_MODE_TOOLTIP)) help.appendChild(node);
  const helpToggle = el("button", { type: "button", className: "help-toggle", text: "?", title: "Show/hide help" });
  helpToggle.setAttribute("aria-expanded", "false");
  helpToggle.addEventListener("click", () => {
    const nowHidden = help.classList.toggle("hidden");
    helpToggle.setAttribute("aria-expanded", String(!nowHidden));
  });

  const label = el("label", { className: "field-label" }, [labelSpan, helpToggle]);
  label.prepend(input);

  const row = el("div", { className: "field-row" }, [label]);
  const fieldBody = el("div", { className: "field-body" }, [row, help]);
  if (state.proMode === true) {
    fieldBody.append(
      el("div", { className: "field-safety-warning pro-mode-warning" }, [
        icon("exclamationCircle"),
        el("span", { text: PRO_MODE_WARNING }),
      ]),
    );
  }
  return el("div", { className: "field" }, [fieldBody]);
}
