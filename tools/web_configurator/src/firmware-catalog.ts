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
 * a literal, nonexistent "legacy%2F<filename>" file. */
function encodeReleasePath(name: string): string {
  return name.split("/").map(encodeURIComponent).join("/");
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
