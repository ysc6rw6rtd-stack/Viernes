import { describe, expect, it } from 'vitest';
import { isNewerVersion, parseRelease, versionFromTag } from './viernes-updates';

describe('viernes updates', () => {
  it('reads the version from release tags', () => {
    expect(versionFromTag('viernes-v1.0.12')).toBe('1.0.12');
  });

  it('compares dotted versions numerically', () => {
    expect(isNewerVersion('1.0.12', '1.0.4')).toBe(true);
    expect(isNewerVersion('1.0.4', '1.0.4')).toBe(false);
    expect(isNewerVersion('1.0.3', '1.0.4')).toBe(false);
  });

  it('picks the Windows installer from a release', () => {
    expect(parseRelease({
      tag_name: 'viernes-v1.0.5',
      html_url: 'https://github.com/x/y/releases/tag/viernes-v1.0.5',
      assets: [
        { name: 'latest.json', browser_download_url: 'https://e/latest.json' },
        { name: 'Viernes_1.0.5_x64-setup.exe', browser_download_url: 'https://e/setup.exe' },
      ],
    })).toEqual({
      version: '1.0.5',
      installerUrl: 'https://e/setup.exe',
      pageUrl: 'https://github.com/x/y/releases/tag/viernes-v1.0.5',
    });
    expect(parseRelease({})).toBeNull();
  });
});
