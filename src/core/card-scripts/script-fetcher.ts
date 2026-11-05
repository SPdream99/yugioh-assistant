import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Fetches a Yu-Gi-Oh card Lua script by passcode.
 * Checks local cache, custom cards, customPath, and remote ProjectIgnis repositories.
 */
export async function fetchCardScript(
  passcode: number,
  customPath?: string
): Promise<string | null> {
  const cwd = process.cwd();

  // 1. Check customPath if provided
  if (customPath) {
    const resolvedCustom = path.isAbsolute(customPath) ? customPath : path.resolve(cwd, customPath);
    if (fs.existsSync(resolvedCustom)) {
      try {
        return await fs.promises.readFile(resolvedCustom, 'utf-8');
      } catch {
        // Continue to other sources if read fails
      }
    }
  }

  const paddedPasscode = String(passcode).padStart(8, '0');
  const cacheDir = path.resolve(cwd, 'data/cache/scripts');
  const customCardsDir = path.resolve(cwd, 'data/custom_cards');

  // 2. Custom cards directory wins for custom passcodes (they do not exist upstream).
  const customCandidates = [
    path.join(customCardsDir, `c${passcode}.lua`),
    ...(passcode < 10000000 ? [path.join(customCardsDir, `c${paddedPasscode}.lua`)] : []),
  ];

  for (const customFile of customCandidates) {
    if (fs.existsSync(customFile)) {
      try {
        return await fs.promises.readFile(customFile, 'utf-8');
      } catch {
        // Continue if custom card read fails
      }
    }
  }

  // 3. Remote fetch from ProjectIgnis CardScripts FIRST (official cards must use the
  // latest upstream script; the local cache is only a network-failure fallback).
  const urlsToTry: string[] = [
    `https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/official/c${passcode}.lua`,
    `https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/scripts/c${passcode}.lua`,
  ];

  if (passcode < 10000000) {
    urlsToTry.push(
      `https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/official/c${paddedPasscode}.lua`,
      `https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/scripts/c${paddedPasscode}.lua`
    );
  }

  for (const url of urlsToTry) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const text = await response.text();
        if (text && !text.startsWith('404: Not Found') && text.trim().length > 0) {
          // Cache the fetched script
          try {
            await fs.promises.mkdir(cacheDir, { recursive: true });
            const cacheDestination = path.join(cacheDir, `c${passcode}.lua`);
            await fs.promises.writeFile(cacheDestination, text, 'utf-8');
          } catch (writeErr) {
            console.warn(`Warning: Failed to cache script c${passcode}.lua:`, writeErr);
          }
          return text;
        }
      }
    } catch {
      // Continue to next URL fallback
    }
  }

  // 4. Network failed: use the local cache as an explicit fallback.
  const cacheCandidates = [
    path.join(cacheDir, `c${passcode}.lua`),
    ...(passcode < 10000000 ? [path.join(cacheDir, `c${paddedPasscode}.lua`)] : []),
  ];

  for (const cacheFile of cacheCandidates) {
    if (fs.existsSync(cacheFile)) {
      try {
        return await fs.promises.readFile(cacheFile, 'utf-8');
      } catch {
        // Continue if cache read fails
      }
    }
  }

  return null;
}
