# Technical reference

How the server is put together, what each subsystem actually does, and where the
limits are. Tool parameters live in [TOOLS.md](TOOLS.md); this document explains
the machinery behind them.

- [1. Design principles](#1-design-principles)
- [2. Runtime model](#2-runtime-model)
- [3. Repository map](#3-repository-map)
- [4. Data lifecycle](#4-data-lifecycle)
- [5. Rulings and rules](#5-rulings-and-rules)
- [6. Deck subsystem](#6-deck-subsystem)
- [7. Market and pricing](#7-market-and-pricing)
- [8. Community decks, combos, counters](#8-community-decks-combos-counters)
- [9. Custom card studio](#9-custom-card-studio)
- [10. Tournament paperwork](#10-tournament-paperwork)
- [11. Reliability and safety](#11-reliability-and-safety)
- [12. Testing and CI](#12-testing-and-ci)
- [13. Extending the server](#13-extending-the-server)
- [14. Limitations](#14-limitations)

---

## 1. Design principles

1. **The engine is the arbiter.** Card text is a paraphrase; the Lua script is the
   behaviour. `ygo_judge_card` reads `c<passcode>.lua`, and `ygo_judge_scenario`
   executes it on `ocgcore-wasm`. When the engine disagrees with a claim, the
   claim is wrong.
2. **No invented data.** A missing price is `null`, a missing combo is
   `available: false`, an unknown archetype is refused. The server never fills a
   gap with a plausible number.
3. **Evidence travels with the answer.** Live data carries a timestamp, a
   freshness score and a SHA-256 hash; rulings carry rulebook/PSCT citations and
   script provenance.
4. **Local-first.** No accounts, no telemetry, no server component. The only
   outbound traffic is read-only public API requests.
5. **One source of truth for the tool surface.** Tools are declared once in
   `src/tools/index.ts`; schemas generate the documentation.

## 2. Runtime model

There are two entry points over the same code:

| Entry | Used by | Behaviour |
| --- | --- | --- |
| `dist/index.js` | MCP clients | registers every tool on stdio; each call returns text plus optional media blocks |
| `dist/cli/index.js` | shell agents and humans | `ygo call <tool> --flag value`, plus install/doctor/docs/cache commands |

`applyDataRoot()` sets the working directory before anything else:

- default: the package root (a source checkout keeps `data/` in the repo);
- published installs: `YGO_DATA_ROOT`, normally `~/.yugioh-assistant-mcp`, so npm cache
  pruning cannot delete user data.

The MCP layer is thin. A tool handler returns a plain object; the wrapper
serialises it, and handlers that produce a PNG/PDF attach a media descriptor that
becomes a real image block instead of base64 text.

Errors are converted to `isError: true` with the tool name and message. Tools that
can partially fail prefer returning `available: false` + `reason` over throwing.

## 3. Repository map

```
src/tools/index.ts          tool declarations (name, description, zod schema, handler)
src/cli/tooling.ts          editorial categories used by docs and `ygo tools`
src/cli/commands/           install, doctor, docs, stats/cache, fetch-data, clean
src/core/card-scripts/      Lua AST, judge, ocgcore runtime, scenarios, resolver
src/core/card-database/     card pool, dossier, search, combo finder
src/core/deck-parser/       ydk/ydke, universal loader, legality
src/core/meta-deck-builder/ templates, live meta sync, matchup, staples, tiers
src/core/pricing/           market index, history, market query, printing prices
src/core/deck-community/    YGOPRODeck, Master Duel Meta, Konami, Format Library
src/core/news-rulings/      rulebook, policy corpus, YGOrganization, citations
src/core/custom-cards/      registry, Lua generator, SVG renderer
src/core/deck-export/       KDE PDF + Neuron-style PNG (Python helpers)
src/core/http/             shared fetch client (queue, retry, rate limit)
skills/                    agent-facing SKILL.md
test/fixtures/             synthetic responses used by offline parser tests
```

## 4. Data lifecycle

### 4.1 Cache layout

| Path | Contents | Refresh |
| --- | --- | --- |
| `data/cache/cards_cache.json` | full card pool from YGOPRODeck (~15k cards) | 7 days, or on demand |
| `data/cache/banlists_cache.json` | per-format banlists | synced with meta |
| `data/ocgcore/cards.cdb` | BabelCDB database for the duel engine | `ygo fetch-data` |
| `data/ocgcore-scripts/` | official + cached Lua scripts | on demand |
| `data/card-scripts/{manual,generated}/` | user overrides and generated scripts | on demand |
| `data/rulebook/`, `data/judge/` | Konami PDFs and extracted text | `ygo fetch-data` |
| `data/wiki/` | Yugipedia pages | 7-day TTL |
| `data/market/history/YYYY-MM-DD.json` | one price snapshot per UTC day | written once per day |
| `data/custom_registry.json`, `data/custom_cards/` | temp-ID card registry and scripts | user actions |

`ygo cache` reports sizes and ages; `ygo cache --clear <area> --yes` deletes an
area (dry run without `--yes`).

### 4.2 Freshness evidence

Every live answer can carry:

```json
{
  "isLive": true,
  "fetchedAt": "2026-11-05T05:08:15.270Z",
  "freshnessScore": 98,
  "badge": "REALTIME_FRESH",
  "sourceUrl": "https://db.ygoprodeck.com/...",
  "evidenceHash": "6cb397db..."
}
```

The score decays with age and the hash is SHA-256 over `sourceUrl|fetchedAt|score|
payload prefix`, so the same payload always produces the same digest. It is a
tamper-evident receipt, not a signature.

### 4.3 Provenance

Scripts and data are labelled wherever a wrong source would change the answer:

- `manual` → `custom` → `official` → `generated` for Lua scripts;
- `live` vs `fallback` for price quotes;
- `official` vs `curated_summary` for rulebook text;
- `snapshot` vs `weekly_views` for market movement.

## 5. Rulings and rules

### 5.1 Card lookup

`CardDatabase` loads the cached pool, indexes by id and name, and falls back to a
live YGOPRODeck fetch. `ygo_card_dossier` merges the database record, the Yugipedia
record, script provenance and optional rulings/prices, reporting a status per
source.

### 5.2 Lua analysis (`ygo_judge_card`, `ygo_script_insights`)

The resolver finds the script in precedence order and reports where it came from.
`lua-ast.ts` parses it with `luaparse` and answers:

- **once per turn**: hard (`SetCountLimit(1, id)`) vs soft (`SetCountLimit(1)`);
- **cost vs effect**: statements before `;` vs after;
- **targeting**: `EFFECT_FLAG_CARD_TARGET` and `Duel.SelectTarget` vs effects that
  choose on resolution;
- **timing**: optional "when" triggers that can miss the window;
- **Damage Step** legality and **negate activation vs negate effect**
  (`CATEGORY_NEGATE` + `EFFECT_FLAG_...`).

`ygo_script_insights` adds a per-effect pipeline (condition → cost → target →
operation), reset duration, spell speed and structural risks.

### 5.3 Real execution (`ygo_run_duel`, `ygo_judge_scenario`)

`ocgcore-runtime.ts` loads `ocgcore-wasm`, `cards.cdb` and the Lua scripts, then
runs a duel with a deterministic seeded shuffle (`mulberry32` + Fisher–Yates). It
returns the engine message timeline (draw, summon, chain, LP, win) and accepts
scripted responses.

`scenario-runner.ts` builds a board, applies decision rules
(`idle`/`chain`/`card`/`effectyn`), captures the real chain, and checks the
caller's expectations. The verdict is `CONFIRMED`, `REFUTED` or `INCONCLUSIVE`;
`ygo_verify_ruling` turns a sentence into such a scenario. `ygo_golden_suite`
replays stored cases after a ProjectIgnis update.

### 5.4 Rulebook and judge corpus

`official-rulebook.ts` downloads Konami's PDF, extracts page text with `pdfjs-dist`
and indexes it with printed page numbers. `official-docs.ts` does the same for the
policy corpus (tournament policy, penalties, PSCT, Fast Effect Timing, Judge FAQ),
keeping per-document versions. Answers quote verbatim text with a page citation;
curated timing summaries are labelled `curated_summary` and never mixed in.

### 5.5 Wiki

`ygo_wiki` uses the Yugipedia MediaWiki API: cards, tabs (rulings, errata, tips,
trivia, gallery, names, lores), pages and search. Requests are serialised with
250 ms spacing, cached for 7 days, and attributed **CC BY-SA 3.0** with the source
URL.

## 6. Deck subsystem

### 6.1 Parsing and legality

`loadDeckUniversal` accepts a `.ydk` path, raw YDK text, a `ydke://` link or a
`DeckData` object. `ydke.ts` encodes/decodes 32-bit little-endian passcode arrays.
`checkDeckLegality` validates Main (40–60), Extra (≤15), Side (≤15), per-format
copy limits and zone placement (Fusion/Synchro/Xyz/Link only in the Extra Deck).

Banlists are per format (TCG, OCG, AE, Genesys, Master Duel) and cached locally.

### 6.2 Building and tuning

`ygo_build_meta_deck` composes an archetype template with live staples for the
format, then re-validates the result. If no template exists it returns
`available: false` + `availableArchetypes`; it never substitutes another deck.

`ygo_optimize_deck` grades staple / hand-trap / board-breaker ratios and proposes
swaps. `ygo_find_synergy_and_combos` matches a stat filter against the pool and
then traces searchers already in the deck.

### 6.3 Consistency lab

`ygo_consistency_lab` deals seeded hands and runs each through ocgcore with a
goldfish responder. It reports two numbers deliberately kept apart:

- `anyActionRate` — at least one legal action existed (a very low bar);
- `engineBoardRate` — the hand reached the Extra Deck or kept a monster.

Average board size and common openers are included. This is a goldfish lower
bound, not a win rate.

### 6.4 Locks and matchups

`ygo_check_locks` reads the scripts and reports summon/activation/material locks,
including anonymous-function checks and `aux.addContinuousLizardCheck`, and flags
contradictions (for example a Special Summon lock next to an Extra Deck lock).

`ygo_matchup_planner` weights the live tier list by tops and produces a role-based
side skeleton. Counter choices are labelled heuristics.

### 6.5 Comparison

`ygo_compare_decks` counts copies per section and returns shared cards, only-A,
only-B, copy differences and an overlap percentage. Same list = 100%; empty vs
full = 0%.

### 6.6 Cost

`ygo_deck_cost` prices unique cards across TCGPlayer / Yuyu-tei / TCGCorner, shows
the cheapest market per card and the potential saving. It marks results partial
rather than inventing prices.

## 7. Market and pricing

### 7.1 Index

`market-index.ts` builds one record per card from the cached pool: aggregate
TCGPlayer price, cheapest/most expensive printing, Cardmarket and eBay values,
weekly views, banlist status, release date and a demand percentile.

`confidence` is `high` (aggregate + ≥2 priced printings), `medium` (aggregate
only) or `low` (listings without a traded price). `confidenceRationale` explains
which case applies, and `printingsListed` is reported separately from
`printingsPriced` so "printed but unpriced" is not mistaken for "only one
printing".

A printing priced more than 25× the aggregate is flagged as an asking price, not
a traded market.

### 7.2 History and movement

There is no free per-card history API for Yu-Gi-Oh!, so the server records its own
snapshot once per UTC day in `data/market/history/`. `intent: "movers"` compares
the oldest snapshot inside the window with the newest and requires two distinct
days; otherwise it returns `available: false` plus a clearly labelled demand
fallback (weekly views) and recent releases. It never reports a percentage it did
not measure.

### 7.3 Rankings

`ygo_market_query` supports `top_price`, `movers`, `explain` and `search`.
`priceBasis` selects aggregate vs top printing vs floor. For "expensive but
sellable", `liquidity_adjusted` scores:

```
score = sqrt(log10(1+price)/log10(1+10000) × log10(1+views)/log10(1+50000))
```

Absolute log scales were chosen after measuring two failures: `price × log(views)`
still ranks a $1,800 / 63-view card 13× above a $58 / 17,481-view card, and
percentiles let rank compression beat real demand. The score is a heuristic, not
money.

`explain` returns drivers (`news`, `banlist`, `release`, `demand`, `collector`,
`meta`, `data`) with confidence and source URLs.

### 7.4 Printing prices

`ygo_card_printing_prices` resolves each printing individually:

- **EN**: the card's sets are mapped to TCGCSV groups; per-product rows carry
  Number, Rarity and TCGplayer market price. Variant names like
  `Card A (UR)` are matched as a variant of `Card A`, but `Card B` is not treated
  as a variant of `Card A`.
- **JP**: Yuyu-tei is queried with the Japanese name resolved from Yugipedia.
- **AE**: TCGCorner Shopify listings are filtered by title.

Any row without a matching listing is `price: null` with a note. Rarity is never
used to infer price.

### 7.5 Multi-market quotes

`getMultiMarketPrices` aggregates TCGPlayer, Yuyu-tei and TCGCorner, normalising
to USD with fixed reference rates. A Cardmarket benchmark is labelled as such and
excluded from live-quote counts.

## 8. Community decks, combos, counters

| Source | Mechanism | Limits |
| --- | --- | --- |
| YGOPRODeck | `/api/decks/getDecks.php` (their own search API) | 20 rows per page; `_sft_post_tag` archetype, `_sft_category` format, plus price/date/card filters |
| Master Duel Meta | `/api/v1/top-decks` | Master Duel only |
| Konami DB | POST form with session cookie + `ytkn`, then one page per recipe | ≤10 recipes, keep `limit` ≤5 |
| Format Library | `/api/decks` + `/api/decks/<id>` (`ydk` string) | list API caps at 100 |

Every deck is normalised to `{ source, url, cards, ydke, combos }`. `ydke` is built
from passcodes so the list feeds `ygo_check_legality`, `ygo_deck_cost`,
`ygo_consistency_lab` and `ygo_optimize_deck` directly.

Konami recipes map card names to passcodes through the card database; unresolved
names are counted in `unresolvedCards` instead of being guessed. Duplicate lists
found on two sources are collapsed by `ydke` and listed under `alsoFoundIn`.

Combos and counters come from Master Duel Meta's public JSON. Combos are ordered
steps with starting cards; counters include counter cards with an author `impact`
label, chokepoints and an explanation. Both corpora are capped at the 300 newest
public entries, and both say so.

## 9. Custom card studio

A new card gets a temporary id (990000000+), a registry record, a generated
ocgcore Lua script and an SVG mockup. `ygo_ensure_script` can also start from a
news article: it extracts the name, stats, text and artwork URLs, assigns a temp
id and verifies the script by loading it into ocgcore with a card-data override.

Generated scripts carry an `AUTO-GENERATED — NOT AN OFFICIAL KONAMI SCRIPT` header
and a confidence level. When the official script appears, it is cached and the
generated file is deleted (`replacedGenerated: true`). A hand-written manual
script is never overridden.

`ygo_migrate_temp_card` rewrites the registry, the Lua filename and every saved
`.ydk` that references the temp id.

## 10. Tournament paperwork

`ygo_generate_tournament_decklist_pdf` fills Konami's KDE decklist AcroForm via a
Python helper (`fill_kde_decklist_pdf.py`) and reports card counts per category.
`ygo_render_deck_image` renders a 10-per-row Neuron-style PNG (`render_deck_grid.py`),
sorted Monsters → Spells → Traps with banned cards flagged. Both accept the same
deck inputs and write through the path guard.

## 11. Reliability and safety

### 11.1 HTTP client

`core/http/fetch-client.ts` is the only outbound path for `fetch`-based modules:

- per-host FIFO queue with minimum spacing (250 ms for TCGCSV, 120 ms otherwise);
- retry on 408/425/429/500/502/503/504 and network errors, exponential backoff
  with jitter, `Retry-After` in seconds or HTTP date;
- automatic `User-Agent: yugioh-assistant-mcp/<version>`;
- per-host stats (requests, retries, failures, latency) used by `doctor --sources`.

Response bodies must be consumed or cancelled: an unconsumed body keeps the undici
connection alive and can stop the CLI from exiting. This was a real bug found by
`doctor --sources`.

### 11.2 Offline mode

`YGO_OFFLINE=1` (or `--offline`) makes `httpFetch` throw `OfflineError` before any
socket is opened. Tools then report `available: false` with the reason. `ygo doctor
--offline` skips network checks entirely.

### 11.3 Path guard

`guardOutputPath` allows writes only inside the project directory or a recognised
simulator install (YGO Omega, EDOPro, Master Duel). Everything else is refused
with an explanation, so a crafted request cannot write to system directories.

### 11.4 Privacy

No telemetry, no accounts, no remote storage. Deck data and custom cards stay on
disk. The server does not phone home.

## 12. Testing and CI

| Suite | Covers |
| --- | --- |
| `npm test` | end-to-end suites: judge, decks, meta, PDF/image, wiki, scenarios, custom cards |
| `test:http` | local server: 503 retry, 429 `Retry-After`, 404 no-retry, spacing, offline |
| `test:fixtures` | parsers against synthetic Yuyu-tei / Konami / TCGCSV / TCGCorner / Format Library / MDM payloads |
| `test:compare` | deck comparison maths |
| `test:pack` | `npm pack` → install in a temp dir → file list + bin + MCP handshake |
| `docs -- --check` | tool tables match the source |

CI runs Ubuntu and Windows on Node 24 and 26, installs the Python PDF/image
dependencies, and runs the pack smoke on one job. Live-source tests degrade to
explicit "unavailable" assertions instead of false passes when a network is down.

Fixtures are refreshed with `npm run fixtures:refresh` when a source changes.

## 13. Extending the server

Add a tool:

1. append an entry to `TOOLS` in `src/tools/index.ts` with a zod schema;
2. add it to a category in `src/cli/tooling.ts` (`validateCatalog` fails otherwise);
3. `npm run build && npm run docs`;
4. add a test if the handler has logic beyond formatting.

Add a data source:

1. route requests through `httpFetch` (never raw `fetch`/axios for new code);
2. identify the app in the User-Agent and respect the source's rate limits;
3. cache responses and expose `available`/`reason` instead of throwing;
4. add a fixture and a parser test — scrapers break silently;
5. credit the source in `docs/CREDITS.md`.

## 14. Limitations

- **AI answers are not guaranteed to be correct.** Every answer, including one
  with citations, is a lead to verify. Check the cited source, the banlist page
  and the market listing before acting on it.
- **Rulings are advisory.** The engine settles interactions, but official
  tournament rulings belong to the head judge.
- **Consistency numbers are goldfish lower bounds**, not win rates.
- **Prices are informational.** No liability for trades; FX is a fixed reference,
  shipping and duty excluded.
- **KR and other languages have no price feed.** The tools return `null`; they do
  not substitute US prices.
- **Combo and counter corpora are capped** at the 300 newest public entries.
- **Community decks are not legal proof** — run `ygo_check_legality`.
- **Meta templates cover a finite archetype list**; unknown archetypes are refused
  rather than approximated.
- **The duel AI is a heuristic policy**, not a learned model; benchmark numbers are
  a sanity check.
