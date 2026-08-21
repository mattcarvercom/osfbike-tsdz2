/**
 * The arrival half of the field-deep-link round trip - render/control.ts's
 * renderFieldShareButton() copies a `#page/fieldKey` URL; this finds
 * whatever `[data-field-key="fieldKey"]` landed on the current page (see
 * renderControl()/renderControlGroup()/renderCellVoltsCard(), all three of
 * which set that attribute), opens its help panel (presumably the reason it
 * was shared) and scrolls it into view with a brief highlight pulse. A
 * no-op if the field isn't on the currently-rendered page - callers are
 * expected to have already navigated to the right page first (see
 * main.ts's startup/popstate handling).
 */
export function highlightField(app: HTMLElement, fieldKey: string): void {
  const target = app.querySelector<HTMLElement>(`[data-field-key="${CSS.escape(fieldKey)}"]`);
  if (!target) return;

  const help = target.querySelector<HTMLElement>(".field-help");
  const toggle = target.querySelector<HTMLElement>(".help-toggle");
  if (help?.classList.contains("hidden")) {
    help.classList.remove("hidden");
    toggle?.setAttribute("aria-expanded", "true");
  }

  target.scrollIntoView({ behavior: "smooth", block: "center" });

  // Force a reflow before re-adding the class, so re-visiting the same link
  // twice in a row restarts the pulse animation instead of the browser
  // seeing "class already present" and doing nothing.
  target.classList.remove("field-highlight-pulse");
  void target.offsetWidth;
  target.classList.add("field-highlight-pulse");
}
