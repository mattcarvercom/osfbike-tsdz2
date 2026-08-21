import "./app-shell.css"; // .page/.page-title/.page-note - built here, but shared with build-page.ts/backup-flash-page.ts and others (also a ".page")
import { SECTIONS } from "../ui-model.ts";
import { controls, state } from "../app-state.ts";
import { el, icon } from "../dom.ts";
import { groupSectionControls, renderControlGroup, renderCellVoltsCard } from "./control-group.ts";
import { renderControl } from "./control.ts";
import { renderRidingModesDZ40 } from "./riding-modes-page.ts";
import { renderProModeToggle } from "./pro-mode.ts";
import { SECTION_ICONS } from "./sidebar.ts";

function renderFieldColorLegend(): HTMLElement {
  return el("div", { className: "field-color-legend" }, [
    el("span", { className: "legend-item" }, [
      el("span", { className: "legend-swatch legend-required" }),
      document.createTextNode("Required for your hardware"),
    ]),
    el("span", { className: "legend-item" }, [
      el("span", { className: "legend-swatch legend-changed" }),
      document.createTextNode("Changed from loaded/saved values"),
    ]),
  ]);
}

export function renderSectionPage(sectionId: string, app: HTMLElement): HTMLElement {
  const section = SECTIONS.find((s) => s.id === sectionId)!;
  const sectionControls = controls.filter((c) => c.section === sectionId);
  const dynamicNote = section.dynamicNote ? section.dynamicNote(state.values) : null;
  // DZ40 can't switch riding modes live (see riding-modes-page.ts's own doc
  // comment) - its Riding modes page gets titled/badged Offroad-mode vs
  // Street-mode cards instead of the plain ungrouped rows every other
  // display type still gets here.
  const body: HTMLElement[] =
    sectionId === "riding-modes" && state.values.displayTypeDZ40 === true
      ? renderRidingModesDZ40(sectionControls, app)
      : groupSectionControls(sectionControls).map((item) =>
          item.kind === "group"
            ? renderControlGroup(item, app)
            : item.kind === "cellVolts"
              ? renderCellVoltsCard(item, app)
              : renderControl(item, app),
        );
  // Not a firmware field (see render/pro-mode.ts's own doc comment on why
  // it's bespoke, not a control-types.ts Control) - "misc" is just the most
  // natural home for a tool-wide preference, first on the page so it's seen
  // before anything its own bypass affects.
  if (sectionId === "misc") body.unshift(renderProModeToggle(app));
  return el("div", { className: "page" }, [
    el("h2", { className: "page-title" }, [
      icon(SECTION_ICONS[sectionId] ?? "misc"),
      document.createTextNode(" " + section.title),
    ]),
    // Motor is SECTIONS[0] - the page most people land on first, and where
    // "required for your hardware" fields (motor type especially) matter
    // most immediately - so this is a one-time explainer seen here, not
    // chrome repeated on every settings page (it used to live in the
    // always-visible footer - see app-shell.css's .field-color-legend
    // comment). The red/amber meanings themselves apply to fields on
    // several other sections too (battery, display, assist, ...), not just
    // this one - the legend just isn't repeated there.
    ...(sectionId === "motor" ? [renderFieldColorLegend()] : []),
    ...(section.note
      ? [el("p", { className: "page-note" }, [icon("infoCircle"), el("span", { text: section.note })])]
      : []),
    ...(dynamicNote
      ? [el("p", { className: "page-note" }, [icon("infoCircle"), el("span", { text: dynamicNote })])]
      : []),
    ...body,
  ]);
}
