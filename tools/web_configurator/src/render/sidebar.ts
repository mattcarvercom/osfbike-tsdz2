import "./sidebar.css";
import { SECTIONS } from "../ui-model.ts";
import {
  state,
  controls,
  controlChanged,
  revertSection,
  BUILD_PAGE,
  BACKUP_FLASH_PAGE,
  DISPLAY_FLASH_PAGE,
  DISPLAY_SIM_PAGE,
} from "../app-state.ts";
import { el, icon, ICONS } from "../dom.ts";
import { renderApp, navigateToPage } from "./app-shell.ts";

export const SECTION_ICONS: Record<string, keyof typeof ICONS> = {
  motor: "motor",
  battery: "battery",
  display: "display",
  lights: "lights",
  assist: "assist",
  "walk-cruise": "walkCruise",
  throttle: "throttle",
  "riding-modes": "ridingModes",
  temperature: "temperature",
  "startup-boost": "startupBoost",
  advanced: "advanced",
  misc: "misc",
  [BUILD_PAGE]: "hammer",
  [BACKUP_FLASH_PAGE]: "buildFlash",
  // Not "display" - that's already SECTIONS' own display-settings config
  // page above, and using the same icon for two different sidebar entries
  // would make them hard to tell apart at a glance. "plug" (SWD-over-ST-Link
  // hardware connection) isn't used by any other nav item.
  [DISPLAY_FLASH_PAGE]: "plug",
  [DISPLAY_SIM_PAGE]: "eye",
};

interface NavItem {
  id: string;
  label: string;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

// Three groups (2026-08-19): "Controller" is the existing per-section
// firmware config (unchanged), "Build & Flash" splits what used to be one
// page into the no-hardware-needed compile step (Build) and everything that
// needs a physical ST-Link (Backup & flash), and "860C Display" groups the
// two display-UI tools together instead of mixing them in with the
// controller config sections above.
function navGroups(): NavGroup[] {
  return [
    { heading: "Controller", items: SECTIONS.map((s) => ({ id: s.id, label: s.title })) },
    {
      heading: "Build & Flash",
      items: [
        { id: BUILD_PAGE, label: "Build" },
        { id: BACKUP_FLASH_PAGE, label: "Backup & flash" },
      ],
    },
    {
      heading: "860C Display",
      items: [
        { id: DISPLAY_FLASH_PAGE, label: "Display firmware" },
        // Runs the real display UI's own C source in a canvas - shown in
        // production too (not just `npm run dev`) so a visitor to the
        // deployed site can preview the UI without owning the hardware,
        // not just as a dev-iteration tool.
        { id: DISPLAY_SIM_PAGE, label: "Display UI sim" },
      ],
    },
  ];
}

function renderNavItem(app: HTMLElement, item: NavItem): HTMLElement {
  const active = state.activePage === item.id;
  const sectionControls = controls.filter((c) => c.section === item.id);
  const hasChanges = sectionControls.some(controlChanged);
  // Both the dot and revert button stay in the DOM always (visibility
  // toggled via "hidden") and carry a data-section-id, so markChanged()'s
  // number/text/signedOffset fast path (see render/control.ts's own
  // comment - it skips the full renderApp() that would otherwise refresh
  // this sidebar) can find and update them directly instead of going
  // stale until the next full render (e.g. navigating sections).
  const dot = el("span", {
    className: `sidebar-dot${hasChanges ? "" : " hidden"}`,
    title: "Unsaved changes in this section",
  });
  dot.dataset.sectionId = item.id;
  const btn = el(
    "button",
    {
      type: "button",
      className: `sidebar-item${active ? " sidebar-item-active" : ""}`,
      onclick: () => navigateToPage(app, item.id),
    },
    [
      icon(SECTION_ICONS[item.id] ?? "misc", "sidebar-icon"),
      el("span", { text: item.label }),
      ...(item.id === DISPLAY_FLASH_PAGE || item.id === DISPLAY_SIM_PAGE
        ? [el("span", { className: "sidebar-badge", text: "Beta" })]
        : []),
      dot,
    ],
  );
  if (active) btn.setAttribute("aria-current", "page");

  // A <button> can't nest another <button> (invalid HTML, breaks click
  // handling) - the revert icon sits as a sibling in its own row div
  // instead of inside btn. Build/Backup & flash/the two Display pages never
  // have sectionControls, so hasChanges is permanently false for them and
  // this stays hidden.
  const revertBtn = el(
    "button",
    {
      type: "button",
      className: `sidebar-revert-btn${hasChanges ? "" : " hidden"}`,
      title: `Revert all changes in "${item.label}"`,
    },
    [icon("revert")],
  );
  revertBtn.dataset.sectionId = item.id;
  revertBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!confirm(`Revert all changes in "${item.label}" back to the last saved/loaded values?`)) return;
    revertSection(item.id);
    renderApp(app);
  });
  return el("div", { className: "sidebar-item-row" }, [btn, revertBtn]);
}

export function renderSidebar(app: HTMLElement): HTMLElement {
  const nav = el(
    "nav",
    { className: "sidebar-nav" },
    navGroups().flatMap((group) => [
      el("div", { className: "sidebar-section-heading", text: group.heading }),
      ...group.items.map((item) => renderNavItem(app, item)),
    ]),
  );

  return el("div", { className: "sidebar" }, [nav]);
}
