/**
 * Fetches the City of Kelowna RSS feeds and writes data/civic.json.
 *
 * Why this exists: kelowna.ca sits behind a WAF that returns 403/500 to
 * public CORS proxies, so the browser can't reach it directly. A GitHub
 * Actions runner can — it sends a normal browser User-Agent and isn't a
 * known proxy. The page then reads the committed snapshot same-origin.
 *
 * Failure policy: never clobber good data. If a feed fails this run, its
 * items from the previous snapshot are carried forward.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const FEEDS = [
  { tag: 'News',     url: 'https://www.kelowna.ca/rss/news.xml' },
  { tag: 'Projects', url: 'https://www.kelowna.ca/rss/cityprojects.xml' },
  { tag: 'Events',   url: 'https://www.kelowna.ca/rss/events.xml' }
];

const OUT = 'data/civic.json';
const PER_FEED_LIMIT = 15;
const TIMEOUT_MS = 20000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Cache-Control': 'no-cache'
};

/** Unwrap CDATA, decode the common entities, drop any inline markup. */
function decode(raw) {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0?39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseItems(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(body);
      return r ? decode(r[1]) : '';
    };
    const title = pick('title');
    if (!title) continue;
    items.push({
      title,
      link: pick('link'),
      pubDate: pick('pubDate') || pick('dc:date') || ''
    });
  }
  return items;
}

async function fetchOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal, redirect: 'follow' });
    const body = await res.text();
    if (!res.ok) {
      // Surface a slice of the body — a Cloudflare interstitial, a login
      // wall and a genuine 404 all look identical from the status code alone.
      const snippet = body.replace(/\s+/g, ' ').slice(0, 220);
      const err = new Error(`HTTP ${res.status} ${res.statusText}`);
      err.detail = `content-type=${res.headers.get('content-type') || 'none'} · body="${snippet}"`;
      throw err;
    }
    const items = parseItems(body);
    if (!items.length) {
      const err = new Error('no <item> elements found');
      err.detail = `content-type=${res.headers.get('content-type') || 'none'} · ` +
                   `${body.length} bytes · starts "${body.replace(/\s+/g, ' ').slice(0, 220)}"`;
      throw err;
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

/** Three attempts with backoff — WAFs often wave through a retry. */
async function fetchFeed(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (err) {
      last = err;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }
  }
  throw last;
}

async function loadPrevious() {
  try {
    return JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return { items: [], sources: {} };
  }
}

const previous = await loadPrevious();
const sources = {};
let items = [];
let failures = 0;

for (const feed of FEEDS) {
  try {
    const fetched = (await fetchFeed(feed.url)).slice(0, PER_FEED_LIMIT);
    sources[feed.tag] = { ok: true, count: fetched.length };
    items.push(...fetched.map((i) => ({ ...i, tag: feed.tag })));
    console.log(`ok    ${feed.tag.padEnd(9)} ${fetched.length} items`);
  } catch (err) {
    failures++;
    const carried = (previous.items || []).filter((i) => i.tag === feed.tag);
    sources[feed.tag] = {
      ok: false,
      error: err.message,
      count: carried.length,
      stale: carried.length > 0
    };
    items.push(...carried);
    console.log(`FAIL  ${feed.tag.padEnd(9)} ${err.message}` +
                (carried.length ? ` — carried ${carried.length} from last run` : ''));
    if (err.detail) console.log(`      ${err.detail}`);
  }
}

// Newest first; undated entries sink to the bottom rather than to the top.
items.sort((a, b) => {
  const ta = Date.parse(a.pubDate) || 0;
  const tb = Date.parse(b.pubDate) || 0;
  return tb - ta;
});

// Never publish an empty snapshot — an empty file would look like "the city
// posted nothing" rather than "the fetch broke". Fail the job instead so the
// Actions run goes red and the previous snapshot stays in place.
if (!items.length) {
  console.error('\nEvery feed failed and there is nothing to carry forward. Snapshot left untouched.');
  process.exit(1);
}

await mkdir('data', { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ generated: new Date().toISOString(), sources, items }, null, 2) + '\n'
);

console.log(`\nWrote ${OUT}: ${items.length} items, ${failures} feed(s) failed.`);
