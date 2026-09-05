import type { Browser, BrowserContext } from 'playwright';

// Lazily-launched, shared headless Chromium instance reused across the whole
// process — launching a browser per request would be far too slow. This is a
// local, single-user, long-lived Node process (`next dev`/`next start`), so a
// module-level singleton is safe and simple; there is no serverless
// cold-start concern here.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import('playwright').then(({ chromium }) =>
      chromium.launch({ headless: true })
    );
    // Reset on failure so a transient launch error doesn't poison the shared
    // singleton for the rest of the process (every later call would otherwise
    // fail instantly with the same rejected promise).
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

const REAL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// One shared context (cookies/session) per process — real search engines are
// more likely to serve normal results to a browser that behaves like a
// returning visitor than to a fresh context on every request.
let contextPromise: Promise<BrowserContext> | null = null;

async function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = getBrowser().then((browser) =>
      browser.newContext({
        userAgent: REAL_USER_AGENT,
        viewport: { width: 1366, height: 900 },
        locale: 'en-US',
      })
    );
    contextPromise.catch(() => {
      contextPromise = null;
    });
  }
  return contextPromise;
}

// Runs `fn` with a fresh page in the shared browser context, always closing
// the page afterward. Returns null (never throws) on any failure so callers
// can fall back gracefully, matching the rest of the discovery/enrichment
// pipeline's "degrade to empty, don't crash the search" convention.
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
