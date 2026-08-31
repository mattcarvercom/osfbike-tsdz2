// Thin client for the manifests firmware-manifest-plugin.ts serves - lets
// the Backup & flash and Display firmware pages list/load release files that
// live only in the repo's releases/motor and releases/display folders
// (symlinked into public/releases, never duplicated into this app - see
// that plugin's own header comment). Both fetches fail soft (empty catalog
// / thrown error on load) rather than crashing the page - a missing
// manifest just means "no built-in releases to offer", not a broken app.

/** Encodes a release name for use in a URL path, segment by segment - manifest
 * names can be a bare filename or "legacy/<filename>" (see
 * firmware-manifest-plugin.ts), and plain encodeURIComponent() would also
 * escape that "/" (to "%2F"), turning a valid nested path into a request for
 * a literal, nonexistent "legacy%2F<filename>" file.
 *
 * Also un-escapes "+" back from encodeURIComponent()'s "%2B": this project's
 * own release names use "+" for SemVer build metadata (e.g.
 * "860C-1.0.0+V13.bootloader.bin", see releases/display/README.md), and
 * Vite's dev server doesn't decode "%2B" back to "+" before resolving the
 * path against the filesystem - it just falls through to the SPA index.html
 * fallback with a 200 status instead of 404ing, which loadDisplayReleaseBinary()
 * then silently accepts as if it were the real firmware. "+" needs no
 * escaping in a URL path (only in a query string), so leaving it alone here
 * is correct, not just a workaround for Vite's behavior. */
function encodeReleasePath(name: string): string {
  return name
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%2B/g, "+"))
    .join("/");
}

async function fetchManifest(url: string): Promise<string[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return (await res.json()) as string[];
  } catch {
    return [];
  }
}

export function fetchMotorReleaseCatalog(): Promise<string[]> {
  return fetchManifest("/releases/motor/manifest.json");
}

export function fetchDisplayReleaseCatalog(): Promise<string[]> {
  return fetchManifest("/releases/display/manifest.json");
}

async function loadReleaseText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return res.text();
}

export function loadMotorRelease(name: string): Promise<string> {
  return loadReleaseText(`/releases/motor/${encodeReleasePath(name)}`);
}

export function loadDisplayRelease(name: string): Promise<string> {
  return loadReleaseText(`/releases/display/${encodeReleasePath(name)}`);
}

/** Binary counterpart to loadDisplayRelease - for 860C/850C UART targets, which take a raw firmware .bin, not Intel HEX text (res.text() would corrupt arbitrary binary bytes via UTF-8 decoding). */
export async function loadDisplayReleaseBinary(name: string): Promise<Uint8Array> {
  const url = `/releases/display/${encodeReleasePath(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
