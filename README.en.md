# dsh-per-request-cost

English | [中文](README.md)

A [DeepSeek Harness](https://github.com/deepseek-ai) Web-UI plugin that renders one compact pill under the composer:

```
¥12.34 · 谷时 · 本次 ¥0.0123
```

It shows the account balance, whether model pricing is currently at peak or off-peak rates, and what the current session has cost so far. **The session figure is real per-request pricing**: every model call is priced at the rate in effect when that call was sent, so a session that crosses 12:00, 18:00, a weekend, or a holiday still totals correctly.

![The pill under the composer; the balance is masked in this screenshot](assets/composer-pill.png)

## Features

| Reading | Source | Refresh |
|---|---|---|
| Balance (recharge + granted) | `account.getBalance` → Platform `get_user_summary` | on mount, every N seconds (default 60, configurable), at the end of every turn, and on click |
| Peak / off-peak phase | local clock, Beijing time | every 30 s, no network |
| Session spend | `sessionCost` Host projection (fallback: `tokenUsage` estimate) | live, as each request settles |

- Both wallet kinds are summed per currency (CNY preferred), because Platform bills them together and spends granted credit first. Hovering the pill breaks the total into recharge and granted amounts.
- Peak windows follow the official rule: Beijing time, Monday–Friday, 09:00–12:00 and 14:00–18:00. Lunch breaks, weekends, and statutory holidays are off-peak all day.
- Holiday dates are not hardcoded to one year: the current year is loaded once from the public [holiday-cn](https://github.com/NateScarlet/holiday-cn) dataset (generated from State Council announcements), with a built-in 2026 list when offline or before a year is published.
- Each request is priced as `hit × hit_rate + (miss + cache_write) × miss_rate + output × output_rate`, per million tokens, at the rate in effect when that request's step started:

| deepseek-flash | off-peak | peak |
|---|---|---|
| input, cache hit | ¥0.02 | ¥0.04 |
| input, cache miss | ¥1 | ¥2 |
| output | ¥4 | ¥8 |

### Search and Fetch charges

Only **DeepSeek's own search API** is billed per request (¥5 per 1,000). Plugins such as `dsh-free-search` route searches to third-party engines — Tavily, Bing, Exa, DuckDuckGo — which are free or use their own quotas and must not appear on a DeepSeek bill. The single rule is whether DeepSeek actually served the request; when that cannot be established, nothing is billed (under-count rather than over-count):

- when the result header names the engine, the name decides: `Search (deepseek-tools):`, `Search (deepseek-official):`, `Search (deepseek-search-api):` count; `Search (tavily):`, `Search (bing):`, `Search (exa):` and other third-party engines show as "not served by DeepSeek" and are never billed;
- a `web_search` result without an engine header came from the core DSH tool, so the plugin reads the search provider `@deepseek-ai/dsh-web` currently selects: only `deepseek-official` / `deepseek-search-api` count, while a free provider such as `ddg` (what `dsh-free-search` registers) does not;
- `web_fetch` works the same way through the fetch provider: only `deepseek-fetch-api` counts, while local or free fetchers such as `http` and `fs-quality-fetch` do not;
- `advanced_search` follows the engine header it reports and counts as one request; `multi_search` fans out across engines and cannot be attributed, so it is not billed.

Everything else:

- one `web_search` call bills once per distinct query (duplicates collapse, matching the tool's own fan-out rule);
- one `web_fetch` call bills once when the page came back with a 2xx status **from DeepSeek's fetch API**;
- error results, `No results found.`, and non-2xx fetches are not billed;
- the requests are counted from the moment they happen, but **add nothing to the cost before Beijing 2026-11-01 00:00** — the free window DeepSeek announced for Harness calls. The hover text still shows the running Search/Fetch counts and marks them free; from that instant the same counts are charged at ¥0.005 each.

## Exact pricing

The Host half folds the durable session log into one client-visible projection, `sessionCost`:

- `step/start` stamps the millisecond a step began, and that stamp is the billing time for the step's request.
- `assistant/message` carries the provider's final usage; `assistant/attempt` carries the last usage chunk of a cancelled or rebuilt stream. A later sample for the same turn/step replaces the earlier one, and `llm/retry-started` closes the replacement slot so a retried attempt is billed again.
- `request/header` supplies the model, selecting the `deepseek-flash` or `deepseek-v4-pro` price list; an unknown model falls back to flash.
- Because the fold runs on the Host, paging and compaction never drop priced history.

If the projection is unavailable (older Host, or a profile without `sessionProjections`), the browser falls back to the previous estimate: whole-session `tokenUsage` at the current phase.

## Holiday data across years

Weekends are computed, so they work for every year. Statutory holidays are announced per year, so the plugin does not pretend to know them all:

- The current Beijing year is fetched **once**, trying sources in order until one answers with a non-empty, same-year schedule:
  1. GitHub raw (`raw.githubusercontent.com/NateScarlet/holiday-cn`), the authoritative dataset;
  2. jsDelivr's GitHub mirror;
  3. **timor.tech** — a mainland-accessible holiday API, used when GitHub and jsDelivr are blocked (its payload is normalized to dates);
  4. ghproxy.net as a last GitHub proxy.

  The Host tries on start and on a daily check, the browser on load. A year already known is never fetched again.
- When the year rolls over, the new year is fetched once; until its announcement is published the source has an empty schedule, so it stays "unknown" and is retried, never cached as holiday-free.
- A payload whose year does not match the request, or a source with no usable dates, falls through to the next channel.
- Any failure across every channel (offline, blocked) keeps the built-in 2026 list; 2027-01-01 is the one certain date beyond it.
- 2027 is currently published as an empty schedule (the State Council announcement is not out yet), so weekdays in 2027 count as peak until that data fills in. Weekends are still off-peak.

The dataset only supplies dates and holiday names; no request carries account data.

## Multi-agent sessions

When a session delegates work to subagents, their model calls run in **child sessions** with their own logs and their own `sessionCost` projection. The parent pill adds the direct children's costs on top of its own:

- the parent's `subagentCatalog` projection names each child;
- the browser asks the session controller for each child's projections (`sessions.refreshProjections`) and sums their `sessionCost` totals;
- the hover text reports `Includes N subagent sessions: ¥x`; a child whose projections have not arrived yet is listed separately as pending instead of being silently counted as zero.

Only the direct children of the open session are added. Grandchildren, or agents running in another workspace, are not included.

## Settings

Open **Plugins → dsh-per-request-cost** and use **Refresh rate** to change the balance interval (10–3600 seconds, default 60). The value is stored per browser and saved with the page's own Save button; the pill picks it up immediately. A finished turn still triggers one extra refresh on top of the interval.

The setting is a browser preference, not profile configuration: it does not touch `cordis.patch.yml` and needs no restart.

## Install

Requires DeepSeek Harness 0.2.x with a signed-in DeepSeek account (the balance comes from the account session, not an API key).

**Option A — Plugin Manager** (Harness ≥ 0.2.1): open **Plugins**, choose *install from a directory*, and point it at this package's directory. The bundle patch registers the row automatically.

**Option B — manual link** into a profile:

```bash
cd "$DSH_PROFILE_DIR"          # e.g. ~/.dsh/profiles/desktop
pnpm add link:/absolute/path/to/dsh-per-request-cost
```

**Option C — straight from GitHub** (recommended): `pnpm add github:Shad0wwa1ker/dsh-per-request-cost`, then add `dsh-per-request-cost` to the profile's `dsh.profile.bundles`.

Then add the bundle to that profile's `package.json`:

```json
"dsh": { "profile": { "bundles": ["dsh-per-request-cost"] } }
```

Reload the page (or restart Harness) once so the browser loads the new client module. The Host projection is Host code: it takes effect on the next Harness start, while the page only needs a reload.

## Configuration

The refresh interval is edited in the plugin's details page (see **Settings**). Prices and the built-in holiday list are constants near the top of `index.js` (pricing and Host holidays) and `client.js` (fallback estimate and phase display); edit them there if DeepSeek changes either. The plugin stores no credentials and makes no requests beyond the account balance call the UI already owns and the public holiday dataset.

## Accuracy notes

- **The session figure prices each request at its own phase.** A request whose step starts before 12:00 stays at peak even if the answer lands after it. The billing timestamp is the step start, which is the closest durable event to when the request was sent.
- **Holiday coverage follows the published schedule.** A date is only known to be a holiday after the State Council announcement exists in the dataset; until then a holiday weekday is priced as peak. Edit `FALLBACK_HOLIDAYS` or point the endpoints elsewhere if you need a different calendar.
- **Model tier comes from the request header.** `deepseek-v4-pro` uses the Pro list; anything else is treated as flash. Custom models that bill differently will be mispriced.
- **Balance is a snapshot.** It reflects Platform at the last refresh, so it can lag the messages you just sent by up to the configured interval.
- **Search/Fetch billing starts on 2026-11-01 00:00 Beijing time.** Only requests DeepSeek itself served are counted: the engine header decides when there is one, otherwise the provider `@deepseek-ai/dsh-web` selects (`selectSearchProvider` / `selectFetchProvider`) does. Third-party engines (Tavily/Bing/Exa) and free providers (`ddg`, `http`, and the like) are free and shown separately in the tooltip. The count is per successful request: distinct queries for Search, 2xx pages for Fetch; an error or an empty search result is not billed. A multi-query call where only some queries returned results is counted as its query count, so it can slightly overstate; `multi_search` mixes engines and is not billed. Switching providers applies to new requests only; counts already recorded are not re-priced.
- **Subagent costs are added only for direct children whose projections have loaded.** A still-loading child appears as pending in the tooltip; nested children are outside the sum.
- **Non-DeepSeek routes** (for example Anthropic-compatible providers) are priced with DeepSeek rates; the pill is meant for a DeepSeek account.

## How it works

- `index.js` — Host half. Registers the `sessionCost` projection with `ctx.sessionProjections`; the fold, price tables, and holiday list live here. Registration is optional, so profiles without the projection registry still load the plugin.
- `client.js` — browser module registered through `window.__ModuleLoader__`. It injects `slots`, `locale`, `remote`, `remote.account`, registers the composer pill and the bundle's configuration page, and reads `useSession` / `useProjection` standard props for turn state and both projections.
- `cordis.patch.yml` — inserts the `per-request-cost` row.
- `locale/*.json` — plugin-manager display metadata (zh / en).

## Privacy

The repository contains no tokens, cookies, account identifiers, balances, or local paths. The pill reads the balance through the Harness account session that is already open; nothing is persisted by the plugin.

## License

MIT