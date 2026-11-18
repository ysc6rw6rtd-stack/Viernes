/**
 * Update check for Viernes: compare the installed version with the latest
 * GitHub release of the Viernes repository and offer the new installer.
 *
 * (The upstream signed auto-updater is off: it would replace Viernes with
 * OpenJarvis builds.)
 */
export const VIERNES_RELEASES_API =
  'https://api.github.com/repos/ysc6rw6rtd-stack/Viernes/releases/latest';

export interface ViernesRelease {
  version: string;
  installerUrl: string;
  pageUrl: string;
}

/** "viernes-v1.0.12" -> "1.0.12". */
export function versionFromTag(tag: string): string {
  return tag.replace(/^viernes-v/i, '').replace(/^v/i, '');
}

/** True when `latest` is a higher dotted version than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.split(/[.-]/).map((p) => parseInt(p, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export function parseRelease(body: any): ViernesRelease | null {
  if (!body || typeof body.tag_name !== 'string') return null;
  const assets: any[] = Array.isArray(body.assets) ? body.assets : [];
  const installer = assets.find((a) => typeof a?.name === 'string' && /x64-setup\.exe$/i.test(a.name));
  return {
    version: versionFromTag(body.tag_name),
    installerUrl: installer?.browser_download_url ?? body.html_url,
    pageUrl: body.html_url,
  };
}

export async function fetchLatestRelease(): Promise<ViernesRelease | null> {
  const res = await fetch(VIERNES_RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  return parseRelease(await res.json());
}

export async function installedVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}

/** The newer release, or null when up to date / not checkable. */
export async function checkForViernesUpdate(): Promise<ViernesRelease | null> {
  const [latest, current] = await Promise.all([fetchLatestRelease(), installedVersion()]);
  if (!latest || !current) return null;
  return isNewerVersion(latest.version, current) ? latest : null;
}

export async function openExternal(url: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
