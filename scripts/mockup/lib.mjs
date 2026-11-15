// Shared helpers for render.mjs and serialize.mjs: find Playwright and start a browser.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// Looks in the current project, next to this skill, and in a private cache directory, so
// the skill never has to add a dependency to the project it is used in.
const CACHE = path.join(os.homedir(), '.cache', 'design-in-figma');

export async function loadChromium() {
  const roots = [process.cwd() + '/', import.meta.url, CACHE + '/'];
  for (const root of roots) {
    const require = createRequire(root);
    for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
      try { return require(name).chromium; } catch { /* try the next one */ }
    }
  }
  throw new Error(`Playwright not found. Install it outside the project with:\n  npm i --prefix "${CACHE}" playwright`);
}

export async function launch() {
  const chromium = await loadChromium();
  try { return await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { return chromium.launch({ headless: true }); }
}

// Splits "a.html b.html --flag value" into files and flags.
export function parseArgs(argv, defaults) {
  const flags = { ...defaults };
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else files.push(path.resolve(argv[i]));
  }
  return { files, flags };
}
