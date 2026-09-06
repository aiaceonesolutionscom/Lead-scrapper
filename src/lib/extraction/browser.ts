import type { BrowserContext } from 'playwright';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'fs';
import path from 'path';

// Per-extraction browser isolation. One extraction's round reads/writes its
// OWN cookies/state — concurrent extractions (up to MAX_CONCURRENT_SEARCHES)
// must never share a Chrome profile, because two sessions hammering Google in
// parallel from one profile got the session flagged and collapsed the feed
// (the 17:01 + 17:06 Karachi runs). AsyncLocalStorage carries the searchId
// through every withPage call so the right context is used automatically.
export const extractionSessionStore = new AsyncLocalStorage<string>();

const BROWSER_CHANNEL = process.env.EXTRACTION_BROWSER_CHANNEL || 'chrome';

const PROFILE_ROOT = path.join(process.cwd(), '.runtime');

// Keyed by searchId -> its own persistent profile + browser context.
const contexts = new Map<string, Promise<BrowserContext>>();

function profileDir(sessionId: string): string {
  return path.join(PROFILE_ROOT, `browser-profile-${sessionId.slice(0, 8)}`);
}

function currentSessionId(): string {
  return extractionSessionStore.getStore() || 'shared';
}

async function getContext(): Promise<BrowserContext> {
  const sessionId = currentSessionId();
  let contextPromise = contexts.get(sessionId);
  if (!contextPromise) {
    contextPromise = (async () => {
      const dir = profileDir(sessionId);
      const { chromium } = await import('playwright');
      await fs.promises.mkdir(dir, { recursive: true });

      const launchOptions = {
        channel: BROWSER_CHANNEL as string | undefined,
        headless: true,
        viewport: { width: 1366, height: 900 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
          '--start-maximized',
        ],
      };

      let context: BrowserContext;
      try {
        context = await chromium.launchPersistentContext(dir, launchOptions);
      } catch (launchError) {
        // Real Chrome is preferred (far weaker automation fingerprint), but
        // if it isn't installed/launchable, fall back to Playwright's bundled
        // Chromium so extraction still works.
        console.error('[Browser] Real Chrome launch failed, falling back to bundled Chromium:', launchError);
        context = await chromium.launchPersistentContext(dir, {
          ...launchOptions,
          channel: undefined,
        });
      }

      // Anti-fingerprint: hide the automation flags that Google's bot
      // heuristics look for. Without this, Google Maps quietly serves a
      // degraded feed (a handful of cards and no phone/website fields).
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        if (!(window as unknown as { chrome?: unknown }).chrome) {
          (window as unknown as { chrome: unknown }).chrome = { runtime: {} };
        }
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
      });

      return context;
    })();

    contextPromise.catch(() => {
      // A failed launch must not poison the map for future calls.
      contexts.delete(sessionId);
    });

    contexts.set(sessionId, contextPromise);
  }
  return contextPromise;
}

// Runs `fn` with a fresh page in this extraction's browser context, always
// closing the page afterward. Returns null (never throws) on any failure so
// callers can fall back gracefully, matching the rest of the discovery/
// enrichment pipeline's "degrade to empty, don't crash the search" convention.
export async function withPage<T>(
  fn: (page: import('playwright').Page) => Promise<T>,
  timeoutMs = 20000
): Promise<T | null> {
  let page: import('playwright').Page | null = null;
  try {
    const context = await getContext();
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    return await fn(page);
  } catch (error) {
    console.error('[Browser] Page operation failed:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors.
      }
    }
  }
}

// Closes THIS extraction's browser and discards its profile so the next
// `withPage` call for that search starts a completely fresh browsing session.
// Used to self-heal when a source (Google Maps) starts returning a
// suspiciously thin feed — the classic sign the current session has been
// flagged, and rotating the profile restores the full feed. (Followed by
// closing the whole search's session when the run finishes weakly.)
export async function resetBrowserSession(): Promise<void> {
  const sessionId = currentSessionId();
  const previous = contexts.get(sessionId);
  contexts.delete(sessionId);
  if (previous) {
    try {
      const ctx = await previous;
      await ctx.close();
    } catch {
      // Browser may already be gone.
    }
  }
  try {
    await fs.promises.rm(profileDir(sessionId), { recursive: true, force: true });
  } catch {
    // Best-effort profile cleanup.
  }
}