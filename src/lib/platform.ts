/**
 * Cross-platform detection utilities.
 * Provides consistent platform detection for UI and behavior branching.
 */

export type PlatformKey = 'darwin' | 'linux' | 'windows';

let cachedPlatform: PlatformKey | undefined;

/**
 * Detect the current platform.
 * Returns 'darwin' for macOS, 'windows' for Windows, 'linux' for everything else.
 */
export function getPlatformKey(): PlatformKey {
  if (cachedPlatform) return cachedPlatform;

  // SSR / Node.js guard — default to linux when navigator is unavailable
  if (typeof navigator === 'undefined') {
    cachedPlatform = 'linux';
    return cachedPlatform;
  }

  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform?.toLowerCase() ?? navigator.platform?.toLowerCase() ?? '';

  if (platform.includes('mac')) {
    cachedPlatform = 'darwin';
  } else if (platform.includes('win')) {
    cachedPlatform = 'windows';
  } else {
    cachedPlatform = 'linux';
  }

  return cachedPlatform;
}

/**
 * Returns true if the current platform is macOS.
 */
export function isMacOS(): boolean {
  return getPlatformKey() === 'darwin';
}
