import "./about-modal.css";
import { el, icon } from "../dom.ts";
import { APP_VERSION, APP_BUILD_DATE } from "../app-state.ts";

interface CreditLine {
  text: string;
  /**
   * Only set when actually verified - either a `users.noreply.github.com`
   * commit email in this repo's own `git log` (ties a name to a real GitHub
   * account without guessing), or a repo/org URL already used elsewhere in
   * this codebase's own docs/vendored git remotes. A name with no verified
   * handle is left as plain text rather than a guessed (and possibly wrong)
   * profile link - see this file's own header comment.
   */
  url?: string;
}

interface CreditGroup {
  heading: string;
  headingUrl?: string;
  lines: CreditLine[];
}

// Curated by hand, not auto-fetched from GitHub's API at build time - a
// build-time API call would add a network dependency (and a 60 req/hr
// anonymous rate limit) to every CI build for a purely cosmetic feature.
// Names/attributions are sourced from this repo's own git history and each
// upstream project's own README/LICENSE header, not guessed - and likewise
// every url below is either a `users.noreply.github.com` commit email
// (`git log --format='%an <%ae>'`) or a repo URL already cited/vendored
// elsewhere in this codebase (see e.g. `vendor/*/`'s own git remotes) - not
// a guessed profile. Update by hand if any of this drifts.
const CREDITS: CreditGroup[] = [
  {
    heading: "TSDZ2 open-source motor firmware",
    lines: [
      { text: "Casainho — original open-source TSDZ2 firmware" },
      { text: "EndlessCadence — core contributor", url: "https://github.com/endlesscadence" },
      { text: "mspider65 — core contributor" },
      { text: "Leon — core contributor", url: "https://github.com/leon927" },
      {
        text: "mbrusa (emmebrusa) — TSDZ2-Smart-EBike-1, this fork's direct upstream",
        url: "https://github.com/emmebrusa/TSDZ2-Smart-EBike-1",
      },
      {
        text: "dzid26 — TSDZ2-Smart-EBike, merged 2026-08-18 (overrun mitigation,",
        url: "https://github.com/dzid26/TSDZ2-Smart-EBike",
      },
      { text: "  startup torque, wheel-speed/cadence fixes, C23, cppcheck CI)" },
      {
        text: "Endless Sphere forum thread (full project history/support)",
        url: "https://endless-sphere.com/forums/viewtopic.php?f=30&t=110682",
      },
    ],
  },
  {
    heading: "860C/850C/SW102 display firmware",
    lines: [
      {
        text: "emmebrusa — Color_LCD_860C, vendored as this fork's display firmware base",
        url: "https://github.com/emmebrusa/Color_LCD_860C",
      },
    ],
  },
  {
    heading: "SDCC — Small Device C Compiler",
    lines: [{ text: "Sandeep Dutta and the SDCC open-source team", url: "https://sdcc.sourceforge.net/" }],
  },
  {
    heading: "mcpp — C/C++ preprocessor",
    lines: [
      { text: "Kiyoshi Matsui — mcpp author" },
      { text: "Vendored via github.com/museoa/mcpp", url: "https://github.com/museoa/mcpp" },
    ],
  },
  {
    heading: "stlink-org/stlink",
    headingUrl: "https://github.com/stlink-org/stlink",
    lines: [
      { text: "texane — original author", url: "https://github.com/texane" },
      { text: "and the stlink-org contributors", url: "https://github.com/stlink-org/stlink/graphs/contributors" },
    ],
  },
  {
    heading: "stm8flash",
    lines: [
      {
        text: "Valentin Dudouyt — the SWIM protocol implementation this tool's WASM flasher is built on",
        url: "https://github.com/vdudouyt/stm8flash",
      },
    ],
  },
  {
    heading: "This fork — osf.bike",
    headingUrl: "https://github.com/mattcarvercom/osfbike-tsdz2",
    lines: [
      { text: "mattcarvercom", url: "https://github.com/mattcarvercom" },
      { text: "plus everyone above whose work it builds on" },
      { text: "Alessandro Polselli", url: "https://github.com/apolselli" },
      { text: "C. Jacobs", url: "https://github.com/ProBackup-nl" },
      { text: "IArchi", url: "https://github.com/IArchi" },
      { text: "stancecoke", url: "https://github.com/stancecoke" },
      { text: "Charlie Palmer, Daniel Lindenaar, Emyr James, j0bro, Laurent Chaussy," },
      { text: "Matteo Boffo (stempelo), Tim Hawes, Yoann Hamon" },
    ],
  },
];

function creditLine(line: CreditLine): HTMLElement {
  if (!line.url) return el("p", { text: line.text });
  const a = el("a", { href: line.url, target: "_blank", rel: "noopener noreferrer", text: line.text });
  return el("p", {}, [a]);
}

/**
 * A true page-level overlay appended to `document.body`, deliberately NOT a
 * child of `#app` - app-shell.ts's renderApp() does a full `app.innerHTML =
 * ""` + rebuild on essentially every state change (any field edit, a build/
 * flash log line arriving, ...), which would silently wipe this modal out
 * from under the user mid-read if it lived inside `#app` instead. Living
 * outside that subtree means it survives every renderApp() call untouched,
 * and only ever closes when the user actually closes it.
 */
export function openAboutModal(): void {
  if (document.querySelector(".about-modal-overlay")) return;

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  const overlay = el("div", { className: "about-modal-overlay" });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeyDown);

  const closeBtn = el("button", { type: "button", className: "about-modal-close", title: "Close", onclick: close }, [
    icon("close"),
  ]);

  const reel = el(
    "div",
    { className: "about-modal-credits" },
    CREDITS.flatMap((group) => [
      el("h3", {}, [
        group.headingUrl
          ? el("a", { href: group.headingUrl, target: "_blank", rel: "noopener noreferrer", text: group.heading })
          : document.createTextNode(group.heading),
      ]),
      ...group.lines.map(creditLine),
    ]),
  );

  const modal = el("div", { className: "about-modal", role: "dialog" }, [
    closeBtn,
    el("div", { className: "about-modal-header" }, [
      icon("bicycle"),
      el("h2", { text: "OSF Bike TSDZ2 Configurator" }),
    ]),
    el("p", { className: "about-modal-version", text: `${APP_VERSION} · built ${APP_BUILD_DATE}` }),
    el("div", { className: "about-modal-scroll-viewport" }, [reel]),
  ]);
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "About");

  overlay.append(modal);
  document.body.append(overlay);
}
