import "./dom.css";

// Generic DOM-building primitives shared by every render/*.ts module - no
// app state, no Control/FieldValues knowledge. If a helper here ever needs
// to read `state` or a Control, it belongs in render/ instead.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { text?: string } = {},
  children: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { text, ...rest } = props as { text?: string } & Record<string, unknown>;
  Object.assign(node, rest);
  if (text !== undefined) node.textContent = text;
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

/**
 * Self-authored line icons - no icon font, no external library, no CDN.
 * Each is hand-built from plain SVG primitives (circle/rect/line/polyline)
 * rather than traced/copied path data from an existing icon set, so there's
 * nothing here to attribute or vendor-update; every icon is a single
 * self-contained string, safe to keep exactly as-is if this ever moves to
 * GitHub Pages. `currentColor` throughout means an icon's color always
 * follows its containing element's `color` - see the `.btn-*` variants in
 * dom.css for how buttons recolor their icon and label together.
 */
const ICON_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
export const ICONS: Record<string, string> = {
  // Gear: distinct from the battery glyph below now that Motor & battery
  // split into separate sidebar sections/icons. (An earlier version used
  // thin radiating lines past the rim - reads as a target/crosshair or a
  // wheel's spokes, not a motor; blockier rectangular teeth read as an
  // actual gear/cog at both sidebar and larger sizes.)
  motor: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/><rect x="10.8" y="0.8" width="2.4" height="4" transform="rotate(0 12 12)"/><rect x="10.8" y="0.8" width="2.4" height="4" transform="rotate(45 12 12)"/><rect x="10.8" y="0.8" width="2.4" height="4" transform="rotate(90 12 12)"/><rect x="10.8" y="0.8" width="2.4" height="4" transform="rotate(135 12 12)"/><rect x="10.8" y="0.8" width="2.4" height="4" transform="rotate(180 12 12)"/><rect x="10.8" y="0.8" width="2.4" height="4" transform="rotate(225 12 12)"/><rect x="10.8" y="0.8" width="2.4" height="4" transform="rotate(270 12 12)"/><rect x="10.8" y="0.8" width="2.4" height="4" transform="rotate(315 12 12)"/></svg>`,
  battery: `<svg ${ICON_ATTRS}><rect x="2" y="7" width="17" height="10" rx="2"/><line x1="21" y1="10" x2="21" y2="14"/><line x1="6" y1="10" x2="6" y2="14"/><line x1="10" y1="10" x2="10" y2="14"/></svg>`,
  // Simple bicycle silhouette (two wheels + frame triangle + seat/handlebar
  // ticks) - used for the topbar logo and (see public/favicon.svg) the
  // browser-tab favicon.
  // y-coordinates shifted up 1.5 from a naive wheels-at-y=18 layout - that
  // left the drawing's visual mass (wheels + frame) sitting below the
  // viewBox's geometric center (y=12), which reads as "hanging low" next
  // to text once centered by flexbox (flex centers the box, not the ink
  // inside it). Tuned by pixel-measuring rendered ink center against the
  // topbar title text's ink center, not just eyeballing the viewBox.
  bicycle: `<svg ${ICON_ATTRS}><circle cx="6" cy="16.5" r="4"/><circle cx="18" cy="16.5" r="4"/><line x1="6" y1="16.5" x2="10" y2="7.5"/><line x1="10" y1="7.5" x2="13" y2="16.5"/><line x1="13" y1="16.5" x2="6" y2="16.5"/><line x1="10" y1="7.5" x2="16" y2="7.5"/><line x1="16" y1="7.5" x2="18" y2="16.5"/><line x1="8.3" y1="6.8" x2="11.3" y2="6.8"/><line x1="14.7" y1="6.8" x2="17.7" y2="6.8"/></svg>`,
  display: `<svg ${ICON_ATTRS}><rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  // Bulb + screw-base rungs - distinct from "assist"'s lightning-bolt glyph
  // (that's about motor power, this is the physical light circuit).
  lights: `<svg ${ICON_ATTRS}><circle cx="12" cy="10" r="6"/><line x1="9.5" y1="16" x2="14.5" y2="16"/><line x1="10" y1="19" x2="14" y2="19"/><line x1="10.5" y1="22" x2="13.5" y2="22"/></svg>`,
  assist: `<svg ${ICON_ATTRS}><polygon points="12,2 5,13 11,13 9,22 19,10 13,10" fill="currentColor" stroke="none"/></svg>`,
  walkCruise: `<svg ${ICON_ATTRS}><circle cx="12" cy="4" r="2"/><line x1="12" y1="6" x2="12" y2="14"/><line x1="12" y1="9" x2="7" y2="7"/><line x1="12" y1="9" x2="18" y2="12"/><line x1="12" y1="14" x2="8" y2="21"/><line x1="12" y1="14" x2="17" y2="20"/></svg>`,
  throttle: `<svg ${ICON_ATTRS}><circle cx="12" cy="13" r="8"/><line x1="12" y1="13" x2="16" y2="8"/><line x1="12" y1="5" x2="12" y2="6.5"/></svg>`,
  // Road in perspective (converging edges + dashed centerline) - Street vs
  // Offroad mode limits, distinct from the throttle gauge above.
  ridingModes: `<svg ${ICON_ATTRS}><line x1="9" y1="21" x2="11" y2="3"/><line x1="15" y1="21" x2="13" y2="3"/><line x1="12" y1="6" x2="12" y2="8.5"/><line x1="12" y1="11" x2="12" y2="13.5"/><line x1="12" y1="16" x2="12" y2="18.5"/></svg>`,
  // Thermometer (bulb + stem) - Optional brake input moved into Throttle & brake,
  // leaving this page purely about the ADC-based temperature sensor.
  temperature: `<svg ${ICON_ATTRS}><rect x="10" y="2" width="4" height="12" rx="2"/><circle cx="12" cy="18" r="4"/></svg>`,
  startup: `<svg ${ICON_ATTRS}><circle cx="12" cy="13" r="8"/><line x1="12" y1="3" x2="12" y2="12"/></svg>`,
  // Upward ramp with an arrowhead - the extra torque/power curve applied
  // right as you start pedaling from a stop, distinct from the power-button
  // glyph above (which is about power-on state, not pedal-start behavior).
  startupBoost: `<svg ${ICON_ATTRS}><path d="M4 18 Q10 18 14 9 T19 4"/><polyline points="14,4 19,4 19,9"/></svg>`,
  advanced: `<svg ${ICON_ATTRS}><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/></svg>`,
  misc: `<svg ${ICON_ATTRS}><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>`,
  // USB connector: body + two contact prongs (left) + a short cable stub
  // (right) - flashing/backup/restore all happen over a real USB cable
  // (WebUSB to the ST-Link), unlike "plug" above (a power-outlet glyph,
  // already used for the ST-Link connection headers on this same page).
  buildFlash: `<svg ${ICON_ATTRS}><rect x="7" y="9" width="10" height="6" rx="1"/><line x1="7" y1="11" x2="4" y2="11"/><line x1="7" y1="13" x2="4" y2="13"/><line x1="17" y1="12" x2="21" y2="12"/></svg>`,
  import: `<svg ${ICON_ATTRS}><path d="M4 20h16"/><path d="M12 3v12"/><polyline points="7,10 12,15 17,10"/></svg>`,
  load: `<svg ${ICON_ATTRS}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  save: `<svg ${ICON_ATTRS}><path d="M4 4h13l3 3v13H4z"/><rect x="7" y="4" width="8" height="5"/><rect x="7" y="14" width="10" height="6"/></svg>`,
  reset: `<svg ${ICON_ATTRS}><path d="M4 12a8 8 0 1 1 2.6 5.9"/><polyline points="4,17 4,12 9,12"/></svg>`,
  revert: `<svg ${ICON_ATTRS}><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v1"/></svg>`,
  hammer: `<svg ${ICON_ATTRS}><line x1="15" y1="9" x2="6" y2="18"/><rect x="12.5" y="2.5" width="5" height="9" rx="1" transform="rotate(45 15 7)"/><line x1="4" y1="20" x2="7" y2="17"/></svg>`,
  download: `<svg ${ICON_ATTRS}><path d="M4 20h16"/><path d="M12 15V3"/><polyline points="7,10 12,15 17,10"/></svg>`,
  upload: `<svg ${ICON_ATTRS}><path d="M4 20h16"/><path d="M12 3v12"/><polyline points="7,8 12,3 17,8"/></svg>`,
  plug: `<svg ${ICON_ATTRS}><line x1="9" y1="2" x2="9" y2="7"/><line x1="15" y1="2" x2="15" y2="7"/><path d="M6 7h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6z"/><line x1="12" y1="17" x2="12" y2="22"/></svg>`,
  folder: `<svg ${ICON_ATTRS}><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>`,
  eye: `<svg ${ICON_ATTRS}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  pause: `<svg ${ICON_ATTRS}><line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/></svg>`,
  play: `<svg ${ICON_ATTRS}><polygon points="7,4 19,12 7,20" fill="currentColor" stroke="none"/></svg>`,
  plus: `<svg ${ICON_ATTRS}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  minus: `<svg ${ICON_ATTRS}><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  // Standard ISO power symbol (circle with a vertical line breaking its
  // top) - a distinct key from "startup" even though the shape is similar,
  // since that one is specifically the sidebar's startup-boost glyph, not
  // a literal power button.
  power: `<svg ${ICON_ATTRS}><circle cx="12" cy="13" r="7"/><line x1="12" y1="4" x2="12" y2="13"/></svg>`,
  check: `<svg ${ICON_ATTRS}><polyline points="4,13 9,18 20,6"/></svg>`,
  // Two-tier warning vocabulary, used throughout the app's advisory/error
  // boxes and status lines: infoCircle for an ordinary "for your awareness"
  // note (field-hint/field-note-box, amber), exclamationCircle for anything
  // genuinely wrong or unsafe (field-safety-warning, build/flash/connection
  // errors, the unsaved-session restore banner - all red/danger-colored via
  // their container, this icon itself is just currentColor). Replaces the
  // former single alertTriangle icon (used for all of the latter group) so
  // the "info" and "danger" tiers are visually distinct, not just by color.
  infoCircle: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none"/></svg>`,
  exclamationCircle: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="9"/><line x1="12" y1="7" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none"/></svg>`,
  file: `<svg ${ICON_ATTRS}><path d="M6 2h9l4 4v16H6z"/><polyline points="15,2 15,6 19,6"/></svg>`,
  // A small note (rect + text lines) with a pencil badged over its bottom-right
  // corner - a bare pencil on its own, sitting right next to the "Loaded: X"
  // file badge, read as "rename the loaded file" rather than "edit notes".
  editNote: `<svg ${ICON_ATTRS}><rect x="1.5" y="2" width="13" height="16" rx="1.5"/><line x1="4.5" y1="7" x2="10.5" y2="7"/><line x1="4.5" y1="11" x2="10.5" y2="11"/><line x1="4.5" y1="15" x2="8" y2="15"/><path d="M11 21l0.8-3.8L18 11l3 3-6.2 6.2z"/><line x1="16.3" y1="12.7" x2="19.3" y2="15.7"/></svg>`,
  // Simple down chevron - the mobile topbar collapse toggle (rotated via CSS when collapsed).
  chevron: `<svg ${ICON_ATTRS}><polyline points="6,9 12,15 18,9"/></svg>`,
  // Bare pencil, no note rectangle - deliberately distinct from editNote
  // above (see that icon's own comment): this one lives right on the
  // "Loaded: X" badge itself, where a bare pencil reads as "rename this"
  // rather than "edit notes". Same tip shape as editNote's badge glyph,
  // shifted -4,-4 so it's centered in the viewBox (editNote's copy is
  // deliberately off-center - it's meant to sit in one corner, badged over a
  // note rectangle - which reads as lopsided/wrong-sized once it's the only
  // thing in the icon, with nothing else around it to justify the offset).
  pencil: `<svg ${ICON_ATTRS}><path d="M7 17l0.8-3.8L14 7l3 3-6.2 6.2z"/><line x1="12.3" y1="8.7" x2="15.3" y2="11.7"/></svg>`,
  // Die showing 5 pips - the display sim's "Randomize" toggle (nudges
  // telemetry sliders on its own to simulate some action happening).
  dice: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none"/></svg>`,
};

export function icon(name: keyof typeof ICONS, extraClass = ""): HTMLElement {
  const span = el("span", { className: `icon${extraClass ? " " + extraClass : ""}` });
  span.setAttribute("aria-hidden", "true"); // decorative - the button/label text next to it already says what this is
  span.innerHTML = ICONS[name];
  return span;
}

/** Button with an icon before its label - the icon inherits the button's `color`, so a `.btn-*` variant class recolors both together. */
/** The label lives in its own `.btn-label` span so CSS can hide it (icon-only buttons on a
 * narrow topbar) without losing the accessible name - `aria-label` carries it regardless of
 * whether the span is visible. */
export function iconButton(
  iconName: keyof typeof ICONS,
  label: string,
  props: Partial<HTMLButtonElement> = {},
): HTMLButtonElement {
  const btn = el("button", { type: "button", ...props }, [
    icon(iconName),
    el("span", { className: "btn-label", text: " " + label }),
  ]);
  if (!btn.hasAttribute("aria-label")) btn.setAttribute("aria-label", label);
  return btn;
}

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadBytes(filename: string, bytes: Uint8Array) {
  // Re-wrap: Emscripten's FS.readFile can hand back a view over a
  // SharedArrayBuffer-backed heap depending on build flags, which Blob's
  // stricter modern lib.dom types reject even though it works at runtime -
  // this guarantees a plain ArrayBuffer-backed copy.
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Splits a tooltip's prose into a small set of DOM nodes instead of one
 * unbroken blob: each sentence becomes its own paragraph, a leading
 * "Term: description" sentence gets its term bolded, and a "Codes: 0 x, 1
 * y, ..." enumeration becomes a bullet list. Generic on purpose - hand-
 * formatting ~150 individual tooltips isn't practical, but nearly all of
 * them already follow one of these two prose patterns.
 *
 * Splits on a lookbehind/lookahead sentence boundary (period/!/? followed
 * by whitespace then a capital/digit) rather than "consume up to and
 * including the next period" - the latter (an earlier version of this
 * function) breaks on tooltips with two or more decimal numbers close
 * together (e.g. "...about 1.9 mph). Recommended range: 25-45 (2.5-4.5...")
 * because greedy-negated-class matching backtracks into the decimal points
 * themselves. This form never treats "1.9" as a sentence end, since there's
 * no whitespace between the period and the following digit.
 */
export function formatHelpText(text: string): Node[] {
  const nodes: Node[] = [];
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const codesMatch = sentence.match(/^Codes:\s*(.+)$/i);
    const items = codesMatch?.[1].replace(/\.$/, "").split(/,\s+/) ?? [];
    if (codesMatch && items.every((item) => /^\d+(-\d+)?\s+/.test(item))) {
      nodes.push(el("p", {}, [el("strong", { text: "Codes:" })]));
      const ul = el("ul", { className: "field-help-list" });
      for (const item of items) {
        const m = item.match(/^(\d+(?:-\d+)?)\s+(.+)$/)!;
        ul.appendChild(el("li", {}, [el("strong", { text: m[1] }), document.createTextNode(` ${m[2]}`)]));
      }
      nodes.push(ul);
      continue;
    }

    const termMatch = sentence.match(/^([A-Z][A-Za-z0-9 .'/-]{1,32}):\s+(.+)$/);
    if (termMatch) {
      nodes.push(
        el("p", {}, [el("strong", { text: `${termMatch[1]}:` }), document.createTextNode(` ${termMatch[2]}`)]),
      );
      continue;
    }

    nodes.push(el("p", { text: sentence }));
  }

  return nodes;
}

/** Above this many options, a toggle-button group stops being more scannable than a dropdown and starts just eating space - fall back to <select>. */
export const TOGGLE_GROUP_MAX_OPTIONS = 3;

/** Compact segmented-button alternative to a <select>, for radio/intSelect controls with few enough options (see TOGGLE_GROUP_MAX_OPTIONS) that showing every choice at a glance beats a click-to-open menu. */
export function renderToggleGroup(
  optionLabels: string[],
  selectedIndex: number,
  disabled: boolean,
  onSelect: (index: number) => void,
): HTMLElement {
  const group = el("div", { className: "toggle-group", role: "radiogroup" });
  optionLabels.forEach((optionLabel, i) => {
    const active = i === selectedIndex;
    const btn = el("button", {
      type: "button",
      className: `toggle-btn${active ? " toggle-btn-active" : ""}`,
      text: optionLabel,
      disabled,
    });
    btn.setAttribute("aria-pressed", String(active));
    btn.addEventListener("click", () => onSelect(i));
    group.appendChild(btn);
  });
  return group;
}

export interface VisualPickerOption {
  label: string;
  image: string;
  /** True for a decorative, unselectable entry (e.g. hardware this tool doesn't support yet) - always disabled regardless of the group's own enabled state, and never wired to onSelect. */
  unimplemented?: boolean;
}

/**
 * Collapsed-by-default dropdown alternative to <select>, for a radio-style
 * control whose options are meaningfully told apart by a picture (e.g.
 * Display type). Only the current selection's thumbnail shows at rest - the
 * full image grid is a click away, not sitting open inline - both so it
 * doesn't crowd out every other field on the page when it's not the field
 * being edited, and so a stray click can't change the selection the way a
 * grid of always-live buttons would (has to be deliberately opened first).
 * Same manual open/close model as renderLabel()'s "?" help toggle elsewhere
 * in this app (click to open, click again to close) - no outside-click
 * auto-dismiss, so there's no listener lifetime to manage across the full
 * app.innerHTML rebuilds a selection triggers. `onSelect` is only ever
 * called with an index into the *implemented* (non-unimplemented) prefix of
 * `options` - see RadioControl.visualPicker's own doc comment for how a
 * caller assembles that list.
 */
export function renderVisualPickerDropdown(
  options: VisualPickerOption[],
  selectedIndex: number,
  groupDisabled: boolean,
  onSelect: (index: number) => void,
): HTMLElement {
  const wrap = el("div", { className: "visual-picker" });
  const current = options[selectedIndex] ?? options[0];

  const trigger = el("button", {
    type: "button",
    className: "visual-picker-trigger",
    disabled: groupDisabled,
  });
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.append(
    el("img", { src: current.image, alt: "", className: "visual-picker-trigger-image" }),
    el("span", { className: "visual-picker-trigger-label", text: current.label }),
    icon("chevron", "visual-picker-trigger-chevron"),
  );

  const panel = el("div", { className: "visual-picker-panel hidden", role: "listbox" });
  const togglePanel = () => {
    const nowHidden = panel.classList.toggle("hidden");
    trigger.setAttribute("aria-expanded", String(!nowHidden));
  };
  trigger.addEventListener("click", togglePanel);

  options.forEach((opt, i) => {
    const active = i === selectedIndex && !opt.unimplemented;
    const classes = ["visual-picker-option"];
    if (active) classes.push("visual-picker-option-active");
    if (opt.unimplemented) classes.push("visual-picker-option-unimplemented");
    const btn = el("button", {
      type: "button",
      className: classes.join(" "),
      disabled: opt.unimplemented === true,
      title: opt.unimplemented ? `${opt.label} - not supported by this configurator yet` : opt.label,
    });
    btn.setAttribute("aria-selected", String(active));
    btn.append(
      el("img", { src: opt.image, alt: opt.label, className: "visual-picker-image" }),
      el("span", { className: "visual-picker-label", text: opt.label }),
    );
    if (!opt.unimplemented) btn.addEventListener("click", () => onSelect(i));
    panel.appendChild(btn);
  });

  wrap.append(trigger, panel);
  return wrap;
}
