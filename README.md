# Kelowna Daily

A single-page local news dashboard for the Central Okanagan. No build step, no
framework — `index.html` is self-contained and reads its feeds at runtime.

## Repo layout

```
index.html                              the page
data/civic.json                         snapshot of the City of Kelowna feeds (generated)
scripts/fetch-civic.mjs                 fetches those feeds server-side
.github/workflows/update-civic-feeds.yml  runs the script every 4 hours
```

## Sources

Fetched live in the browser:

| Source | Feed |
|---|---|
| Castanet | `castanet.net/rss/mostrecent.xml` |
| KelownaNow | `kelownanow.com/api/rss/128` |
| Capital News | `kelownacapnews.com/feed` |
| Global News Okanagan | `globalnews.ca/okanagan/feed/` |
| Weather | Open-Meteo (sends CORS headers — no proxy needed) |

Fetched by GitHub Actions, read from `data/civic.json`:

| Source | Feed |
|---|---|
| City · News | `kelowna.ca/rss/news.xml` |
| City · Projects | `kelowna.ca/rss/cityprojects.xml` |
| City · Events | `kelowna.ca/rss/events.xml` |

### Why the City feeds are handled differently

`kelowna.ca` sits behind a WAF that returns 403 or 500 to public CORS proxies,
so the browser can't reach it no matter which proxy is tried. A GitHub Actions
runner can: it sends a normal browser User-Agent and isn't on a proxy blocklist.
The workflow commits the result to `data/civic.json`, and the page reads that
file same-origin — no CORS, no proxy, no rate limit.

If `data/civic.json` is missing (fresh clone, or the page opened as a local
file), the page falls back to trying the City feeds live through the proxy chain.

## Setup

1. Push these files to a repo.
2. **Settings → Pages** → Source: *Deploy from a branch*, branch `main`, folder `/`.
3. **Settings → Actions → General** → Workflow permissions: *Read and write*.
   Without this the job can't push the snapshot.
4. **Actions → Update civic feeds → Run workflow** to seed `data/civic.json`
   immediately rather than waiting for the first scheduled run.

## Behaviour notes

- The schedule is `17 */4 * * *` (UTC). GitHub delays scheduled runs under load;
  a miss of 10–30 minutes is normal and not worth chasing.
- If one City feed fails, its items from the previous snapshot are carried
  forward and the Feed status panel marks it *stale*.
- If every City feed fails and there's nothing to carry forward, the job exits
  non-zero and leaves the existing snapshot alone, so the run goes red rather
  than silently publishing an empty list.
- GitHub disables scheduled workflows on repos with no activity for 60 days.
  Since this one commits regularly, that shouldn't trigger.

## Adjusting

Feeds are declared at the top of the `<script>` block in `index.html`
(`FEEDS` and `CIVIC_FEEDS`) and at the top of `scripts/fetch-civic.mjs`
(`FEEDS`). Keep the two `CIVIC_FEEDS`/`FEEDS` tag names in sync — the page
matches snapshot entries to sources by tag.

`LOCAL_REGIONS` in `index.html` controls what counts as local for the
Central Okanagan / Everything toggle. Castanet is a Thompson-Okanagan-wide
wire and tags each headline with its region; the other sources are treated
as local by default.
