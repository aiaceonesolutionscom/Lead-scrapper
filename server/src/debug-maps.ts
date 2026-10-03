// Temporary debug: faithfully replicate the pipeline detail pass (find first
// real card, use its href, goto with 30s timeout, poll h1) to reproduce / bisect
// the blank place page the pipeline always gets.
import { withPage } from '@/lib/extraction/browser';

await withPage(async (page) => {
  await page.goto('https://www.google.com/maps/search/' + encodeURIComponent('Restaurants in Karachi, Pakistan'), {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });

  const consentButton = page
    .locator('button:has-text("Accept all"), button:has-text("Reject all"), button:has-text("Agree"), button[aria-label*="Accept"]')
    .first();
  if ((await consentButton.count().catch(() => 0)) > 0) {
    try { await consentButton.click({ timeout: 2000 }); await page.waitForTimeout(800); } catch {}
  }

  const CHROME = (s: string) => {
    const plain = (s || '').replace(/[\uE000-\uF8FF]/gu, ' ').replace(/\s+/g, ' ').trim();
    return /^(hours|all filters|results|saved|recents|get app|share)(\s|$)/i.test(plain) ||
      /^price\s+rating\s+hours\s+all\s+filters/i.test(plain);
  };

  let feedReady = false;
  for (let w = 0; w < 45 && !feedReady; w++) {
    await page.waitForTimeout(700);
    feedReady = (await page.locator('[role="feed"] > div').count().catch(() => 0)) > 0;
  }
  console.log('feed ready:', feedReady);
  const feed = page.locator('[role="feed"] > div');
  const count = await feed.count().catch(() => 0);
  console.log('cards:', count);

  // pipeline scroll loop
  for (let s = 0; s < 30; s++) {
    const f = page.locator('[role="feed"]').first();
    if (await f.count().catch(() => 0)) {
      await f.evaluate((el) => { (el as HTMLElement).scrollBy(0, 2200); }).catch(() => {});
    } else {
      await page.mouse.wheel(0, 1200).catch(() => {});
    }
    await page.waitForTimeout(600);
  }
  console.log('scrolled; url=', page.url().slice(0, 90));

  // find FIRST real card + href
  let idx = -1;
  let href: string | null = null;
  for (let i = 0; i < count; i++) {
    const txt = ((await feed.nth(i).innerText().catch(() => '')) || '').trim();
    const first = txt.split('\n').find((l: string) => l.trim() && !CHROME(l.trim())) || '';
    if (first) {
      idx = i;
      href = await feed.nth(i).locator('a').first().getAttribute('href').catch(() => null);
      console.log('card', i, '=', first.slice(0, 40), 'href=', (href || '').slice(0, 70));
      if (href) break;
    }
  }
  if (!href) { console.log('no href'); return; }
  const abs = href.startsWith('http') ? href : 'https://www.google.com' + href;

  const resp = await page.goto(abs, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('nav status:', resp?.status(), 'finalUrl:', page.url().slice(0, 90));
  const bodyHead = (await resp?.text().catch(() => '') || '').slice(0, 220);
  console.log('bodyHead:', JSON.stringify(bodyHead));

  let h1: string | null = null;
  for (let w = 0; w < 60 && !h1; w++) {
    await page.waitForTimeout(250);
    h1 = await page.locator('[role="main"] h1').first().textContent({ timeout: 250 }).catch(() => null);
  }
  console.log('h1 after poll:', JSON.stringify(h1?.trim().slice(0, 120)));
  const dump = await page.evaluate(() => ({
    docTitle: document.title,
    hasMain: !!document.querySelector('[role="main"]'),
    mainLen: document.querySelector('[role="main"]') ? (document.querySelector('[role="main"]') as HTMLElement).innerText.length : -1,
    bodyHead: (document.body?.innerText || '').slice(0, 100),
  })).catch((e) => ({ err: (e as Error).message }));
  console.log('dump:', JSON.stringify(dump, null, 2));
}, 60000);

process.exit(0);