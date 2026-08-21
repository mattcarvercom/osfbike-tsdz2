// Hash-based page/field routing: `#<pageId>` or `#<pageId>/<fieldKey>`. Hash,
// not a real path (`/motor`), on purpose - this app deploys as static
// Cloudflare Workers assets with no server-side rewrite rule for unknown
// paths, so a real path would 404 on a fresh visit unless the deploy is also
// reconfigured for SPA fallback. A hash fragment never leaves `/`, so a
// shared/bookmarked deep link always lands, regardless of deploy config, and
// it still gets full back/forward-button support via history.pushState below.
//
// Parsing/building split out as pure functions (parseHash/buildHash), kept
// free of `location`/`history` so they're directly unit-testable under plain
// `node --test` - same reasoning session.ts's own header comment gives for
// keeping *that* module DOM-free. readUrlLocation/writeUrlLocation/
// fieldShareUrl are the thin browser-coupled wrappers around them.

export interface UrlLocation {
  page: string;
  /** A Control.key (or, for a radio group, its first groupKeys entry) - see app-state.ts's controlKeys(). Null for an ordinary page navigation with nothing specific to point at. */
  field: string | null;
}

/** Parses a `location.hash`-shaped string (leading "#" optional). Null means no hash was present at all (a fresh visit with no share link, not "page with no field"). */
export function parseHash(raw: string): UrlLocation | null {
  const trimmed = raw.replace(/^#/, "");
  if (!trimmed) return null;
  const [rawPage, rawField] = trimmed.split("/");
  if (!rawPage) return null;
  return { page: decodeURIComponent(rawPage), field: rawField ? decodeURIComponent(rawField) : null };
}

export function buildHash(page: string, field: string | null): string {
  return field ? `#${encodeURIComponent(page)}/${encodeURIComponent(field)}` : `#${encodeURIComponent(page)}`;
}

/** Reads the current `location.hash`. */
export function readUrlLocation(): UrlLocation | null {
  return parseHash(location.hash);
}

/** Builds a full, absolute shareable URL for one field - what the help panel's chain-link button copies to the clipboard. */
export function fieldShareUrl(page: string, field: string): string {
  return `${location.origin}${location.pathname}${buildHash(page, field)}`;
}

/**
 * Writes `location.hash` to match the given page/field. `replace: true` uses
 * `history.replaceState` (no new back-button stop) - used for the initial
 * load's own hash normalization and for consuming a one-time deep link, so
 * the back button doesn't retrace steps the user never actually took.
 * Ordinary in-app navigation (sidebar clicks, etc) pushes a real entry
 * instead, which is the whole point of this feature - see navigateToPage()
 * in render/app-shell.ts.
 */
export function writeUrlLocation(page: string, field: string | null, replace = false): void {
  const hash = buildHash(page, field);
  if (hash === location.hash) return;
  if (replace) history.replaceState(null, "", hash);
  else history.pushState(null, "", hash);
}
