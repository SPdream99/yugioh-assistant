# Changelog

## 0.9.4 — first public beta

First published release. Everything below is part of the initial public surface.

**Status: beta.** The project is under active development, bugs are expected, and
the tool surface may change between 0.9.x releases. Check for updates before use
and pin a version when stability matters.

### Added — market intelligence
- **`ygo_market_query`** — ranks and filters the whole priced pool instead of one card:
  `top_price`, `movers`, `explain`, `search`, with price/demand/liquidity sorting.
  `sortBy: "liquidity_adjusted"` scores `sqrt(logPriceNorm × logDemandNorm)` so a
  $1,800 / 63-view collector card no longer outranks a $58 / 17,481-view card.
- **`ygo_card_printing_prices`** — per-printing, per-rarity, per-language prices.
  EN comes from TCGCSV per-product data (Number + Rarity), JP from Yuyu-tei, AE from
  TCGCorner. KR/DE/FR/IT/SP/PT/SC/TC have no public feed and return `price: null`.
- Daily price snapshots under `data/market/history/`; `movers` refuses to report a
  delta until two distinct days exist.

### Added — community content
- **`ygo_find_community_decks`** — decks from YGOPRODeck (community + tournament,
  7 filters incl. `tournament`, `price`, `date`, `containsCard`), Master Duel Meta,
  Konami's official card database (Neuron recipes) and Format Library (GOAT/Edison).
  Every deck carries its page URL and a `ydke://` link for the other tools.
- **`ygo_find_combos`** — structured published combos (starting cards + ordered steps).
- **`ygo_find_counters`** — counter cards, chokepoints and explanations per deck type.
- `category` accepts YGOPRODeck's `/category/type/<slug>` taxonomy or a bare archetype.

### Fixed
- The rulebook test asserted the cached PDF was under one day old, so `npm test`
  failed whenever a local cache was between 1 and 7 days old (its actual TTL). It
  now checks a real age inside the TTL and cross-checks the `stale` flag.
- Yuyu-tei was queried with the English name, matched nothing, and its fallback
  scraped unrelated yen figures (a one-of-a-kind card showed ¥320). It now resolves
  the Japanese name through Yugipedia and returns `price: 0` + a search link when no
  listing matches.
- TCGCorner's Cardmarket benchmark was presented as a live AE listing (and read as
  HKD). It is now flagged `isFallback`, converted as EUR, and excluded from live
  counts and cross-market enrichment.
- TCGPlayer's aggregate price was labelled "Market Average"; it is the cheapest
  commonly listed printing and is now labelled as such.
- `confidence: medium` now ships a `confidenceRationale`, and `printingsListed` is
  separated from `printingsPriced`, so "printings exist but none is priced" is no
  longer confused with "only one printing exists".
- Konami recipe parsing used the row index as the copy count (40/15/7 read as
  147/120/6); it now reads the trailing `td.num`.
- Format Library's list API returns zero items at `limit=200`; the cap is 100.
- Card cache now restores its timestamp from disk, so freshness and refresh decisions
  are accurate after a restart.

### Changed
- Version 1.1.0 → 1.2.0. 53 tools.
- New [`docs/CREDITS.md`](docs/CREDITS.md) with full source attribution, licences and
  data-usage rules; README and LEGAL.md link to it.
- Test package no longer ships compiled `test_*.js` files.

### Hardening before release

- **Shared HTTP client** (`src/core/http/fetch-client.ts`): per-host FIFO queue, minimum spacing (TCGCSV 250 ms), retry with exponential backoff and jitter on 408/425/429/5xx and network errors, `Retry-After` support, per-host stats. All YGOPRODeck / TCGCSV / Master Duel Meta / Konami / Format Library calls go through it.
- **Retry contract test** (`npm run test:http`) against a local server: 503 → retried to success, 429 → honours `Retry-After`, 404 → never retried, spacing measured.
- **Parser fixtures** (`test/fixtures/`, `npm run test:fixtures`): recorded Yuyu-tei HTML, Konami recipe HTML, TCGCSV per-printing JSON, TCGCorner suggest JSON, Format Library ydk and Master Duel Meta combos/counters are parsed offline. Refresh with `npm run fixtures:refresh`. A markup change now fails CI instead of returning a plausible wrong number.
- **Package install smoke** (`npm run test:pack`): `npm pack` → install into a clean temp project → verify the published file list, the `ygo` bin, and a real MCP `initialize` + `tools/list` (53 tools). Runs in CI.
- Removed compiled `test_*.js` from the published tarball.

### Added — deck tooling and operations

- **`ygo_compare_decks`** — section-by-section diff of two lists: shared core, only-A, only-B, copy-count differences and an overlap percentage.
- **Cross-source deck dedupe** — the same list found on YGOPRODeck and Konami is collapsed by its `ydke`; the kept entry lists the other sources under `alsoFoundIn`.
- **`ygo cache`** (alias of `stats`) with `--clear <area>`, `--yes` and `--dry-run`. Areas: cards, engine, scripts, rulebook, judge, wiki, generated, custom, exports, renders, market, all.
- **Offline mode** — `ygo call … --offline` or `YGO_OFFLINE=1` makes every outbound call fail fast with an explicit reason; tools report `available: false` instead of hanging.
- **`ygo doctor --sources`** pings nine upstream APIs and reports status + latency; **`--fix`** downloads missing data first.
- **CI matrix** now runs Ubuntu + Windows on Node 20 and 22, with Python deps installed for the PDF/image suites.

### Security

- Fixed a command-injection path: `ygo_render_deck_image` built a shell string from the deck title. It now uses `execFile` with an argument array, so shell metacharacters are inert.
- Added an SSRF guard for caller-supplied article URLs: public http(s) only, DNS-resolved, private/loopback/link-local/metadata addresses and non-http schemes refused; article bodies capped at 5 MB.
- Path-guarded every file writer (deck PNG/PDF, DOCX, art slicing, script migration); game-root matching now requires a real path segment, not a substring.
- Size caps: 1 MB MCP tool arguments, 1 MB CLI JSON, 2 MB deck files, with binary-file rejection.
- Upgraded zod to 4.6.7 (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized constrained collections); `npm audit --omit=dev` is clean.

### Docs

- README rewritten around what the server does, how it is installed and what data it uses; tool tables remain generated.
- New [`docs/TECHNICAL.md`](docs/TECHNICAL.md): runtime model, data lifecycle, every subsystem (rulings, decks, market, community, custom cards, paperwork), reliability, testing, extension guide and limitations.
- Vietnamese README brought in line with the English one; tool names and short summaries stay in English to match the MCP schema.
- Repository text is English-only except the intentional `docs/vi/` translations (`README`, `LEGAL`, `CREDITS`).
- README states that the tool was built almost entirely by AI agents under human supervision and testing, and cross-links the npm package and GitHub repository.

### Project

- Renamed the project to **`yugioh-assistant-mcp`** (npm package, GitHub repository, MCP registry name and skill). The CLI command is still **`ygo`**; both `npx -y yugioh-assistant-mcp ...` and `ygo ...` work. The Glama listing keeps its original slug until the re-index follows the rename.
- Credited the related open-source projects consulted during development (other Yu-Gi-Oh! MCP servers, deck builders, price trackers, ruling tools and MCP infrastructure); only listed dependencies and data sources ship.
- The Konami deck-list form is **no longer bundled**: `ygo fetch-data` downloads it from Konami on demand (or `YGO_KDE_TEMPLATE` points at a local copy). The npm tarball dropped from ~535 kB to ~390 kB.
- The ProjectIgnis procedure libraries are downloaded by `fetch-data` instead of being committed; the archetype studio copies them from `data/ocgcore-scripts/`.
- Test fixtures are now **synthetic** (`scripts/make-fixtures.mjs`): no captured third-party pages, usernames or personal data in the repository.
- Public examples and documentation now use placeholders (`Card A`, `Card B`, an archetype) instead of official card names; scenario preset ids were renamed to neutral names (`negate-protected`, `negate-unprotected`, `hopt-after-negate`, `draw-blocked`). Functional card data and tests still use real records by passcode, because the MCP must resolve them to operate.
- README, LEGAL, TECHNICAL and the agent skill now state explicitly that **AI answers are not guaranteed to be correct**; every ruling, price and suggestion is a lead to verify, not an authority.
- Removed generated and duplicate files (a committed Python bytecode cache, an English duplicate of the tool catalogue, and maintainer-only pages); `SECURITY.md` now links to the correct CREDITS file. The npm tarball ships only runtime and user-facing files: 123 files, ~370 kB.
- `Dockerfile` (multi-stage, `node:24-bookworm-slim`) and `.dockerignore` for container checks; the server starts over stdio and answers introspection without external data.
- Listed on Glama: <https://glama.ai/mcp/servers/SPdream99/yugioh-assistant> (score badge in the README and in the awesome-mcp-servers entry).
- `SECURITY.md` with a private reporting flow and scope.
- `NOTICE`: what is excluded from the AGPL, plus an explicit commitment to remove the repository and npm package on a rights-holder request.
- Test fixtures documented in `test/fixtures/README.md`; usernames, Discord ids and
  profile hashes removed, and the Konami/TCGCorner scrapers now identify the
  application in their User-Agent.
- GitHub issue forms (bug/feature) and a release workflow that publishes with npm provenance only when the repository is public.
- CI test workflow gained concurrency cancellation.

## Internal pre-release (unpublished)

The tool surface was developed before the first public version: judge/rulings,
deck building, meta tracking, pricing, tournament paperwork and the custom-card
studio. No public build was ever published under these version numbers.
