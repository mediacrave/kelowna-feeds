# Kelowna Daily

A single-page local news dashboard for the Central Okanagan. No build step, no
framework, no dependencies — `index.html` is self-contained and fetches its
feeds at runtime.

## Sources

| Source | Feed |
|---|---|
| Castanet | `castanet.net/rss/mostrecent.xml` |
| KelownaNow | `kelownanow.com/api/rss/128` |
| Capital News | `kelownacapnews.com/feed` |
| Global News Okanagan | `globalnews.ca/okanagan/feed/` |
| Weather | Open-Meteo |

The four news feeds merge into a single reverse-chronological river, each item
tagged with its source. Open-Meteo drives the conditions bar and five-day panel;
it sends CORS headers, so it needs no proxy.

## Hosting

Drop `index.html` at the root of a repo, then **Settings → Pages** → Source:
*Deploy from a branch*, branch `main`, folder `/`.

## How feeds are fetched

Browsers can't request most RSS feeds directly — the servers don't send CORS
headers. Each feed is tried through a chain of public proxies until one works:
rss2json, allorigins, codetabs, thingproxy, then a direct request. The Feed
status panel in the sidebar reports which transport succeeded, or the exact
error from each one if a source is down.

## Known limitation: City of Kelowna

`kelowna.ca/rss/*.xml` feeds are behind Cloudflare, which blocks datacenter IP
ranges. Public CORS proxies get 403, and so do GitHub Actions runners (Azure
IPs), so a server-side snapshot doesn't help either. Only a residential IP
reaches them. If you want city feeds later, the options are a self-hosted
Actions runner or a cron job on a home server. Castanet and Capital News cover
most council and civic news in the meantime.

## Adjusting

Feeds are declared in the `FEEDS` array at the top of the `<script>` block.

`LOCAL_REGIONS` controls the Central Okanagan / Everything toggle. Castanet is a
Thompson-Okanagan-wide wire that tags each headline with its region in a
trailing parenthetical; the page parses that out and filters on it. The other
three sources are Kelowna-focused and always count as local.

Refreshes automatically every 30 minutes, or on demand via the Refresh button.
