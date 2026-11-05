<div align="center">

# Yu-Gi-Oh! Assistant

**A tournament-grade judge, deck builder and market analyst any AI agent can call over MCP.**

[![MCP](https://img.shields.io/badge/Model_Context_Protocol-stdio-blue)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/yugioh-assistant-mcp)](https://www.npmjs.com/package/yugioh-assistant-mcp)
[![status](https://img.shields.io/badge/status-beta-orange)](CHANGELOG.md)
[![Glama](https://glama.ai/mcp/servers/SPdream99/yugioh-assistant/badges/score.svg)](https://glama.ai/mcp/servers/SPdream99/yugioh-assistant)
[![Node](https://img.shields.io/badge/node-%E2%89%A5_24-339933)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)
[![License](https://img.shields.io/badge/license-AGPL--3.0--only-blue)](LICENSE)

[English](README.md) · [Tiếng Việt](docs/vi/README.md) · [Technical reference](docs/TECHNICAL.md) · [Credits](docs/CREDITS.md)

</div>

---

Most card-game assistants paraphrase card text. This one reads the **Lua script the
game engine actually runs**, and can execute it: `ygo_judge_card` parses
`c<passcode>.lua` from [ProjectIgnis](https://github.com/ProjectIgnis/CardScripts),
and `ygo_judge_scenario` runs a real duel on `ocgcore-wasm` to settle the question.

It ships as a standard MCP server on stdio (Claude Code, Claude Desktop, Codex,
OpenCode, Cursor, VS Code, Windsurf, Gemini CLI, Cline, Zed) plus a `ygo` CLI for
shell-only agents.

Everything runs locally. Network calls are read-only public APIs, cached under
`data/`; the full source list with licences is in [docs/CREDITS.md](docs/CREDITS.md).

> **Status: beta (0.9.x), under active development.** Bugs are expected and the
> tool surface will change. Check for updates before you rely on it:
> `npx -y yugioh-assistant-mcp@latest --version`, `ygo doctor`, and the
> [releases page](https://github.com/SPdream99/yugioh-assistant-mcp/releases). Pin
> `@0.9.4` when you need a fixed version.

> **Built with AI.** The code, tests and documentation in this repository were
> written almost entirely by AI agents, with human supervision, review and
> hands-on testing by the maintainer. **AI output is not guaranteed to be
> correct.** Treat every answer, ruling and price this tool produces as a lead to
> verify, not as a final authority: check the cited source, the banlist page and
> the market listing before acting on it.

> **Related work.** This project was developed with reference to many related
> open-source projects — Yu-Gi-Oh! MCP servers, deck builders, price trackers,
> ruling tools and MCP infrastructure — to compare approaches and conventions.
> Only the dependencies and data sources listed in
> [docs/CREDITS.md](docs/CREDITS.md) are included; no code was copied from an
> unlisted project.

## Install

Requires Node 24+ (ocgcore-wasm needs JSPI). Python 3 is only needed for PDF, image and DOCX tools.

Package page: <https://www.npmjs.com/package/yugioh-assistant-mcp> ·
Source: <https://github.com/SPdream99/yugioh-assistant-mcp>.

```bash
# 1. one-time data bootstrap: card database, rulebook, judge corpus, Konami deck form
npx -y yugioh-assistant-mcp fetch-data

# 2. wire the server into every AI client detected on this machine
npx -y yugioh-assistant-mcp setup
```

From source:

```bash
git clone <your-fork-url> yugioh-assistant-mcp
cd yugioh-assistant-mcp
npm install && npm run build
node dist/cli/index.js setup
```

`setup` writes one entry per client and backs up every file it edits
(`.ygo-<timestamp>.bak`). Preview first or target specific clients:

```bash
ygo install --client claude-code,cursor --dry-run
ygo status
ygo uninstall
```

<details>
<summary>Manual MCP configuration</summary>

```json
{
  "mcpServers": {
    "yugioh-assistant-mcp": {
      "command": "node",
      "args": ["C:\\path\\to\\yugioh-assistant-mcp\\dist\\index.js"]
    }
  }
}
```

The installer also handles VS Code (`servers`), Codex (`config.toml`), OpenCode
(`mcp.servers`) and Zed (`context_servers`).
</details>

## What you can ask

| Area | Example |
| --- | --- |
| Rulings | *"Card A chained to Card B — what resolves?"* |
| Rulebook | *"Quote the Damage Step rules with the printed page."* |
| Deck building | *"A legal list for an archetype, OCG, 60 cards."* |
| Deck analysis | *"How often does this list reach a real board?"* |
| Community | *"Show me decks for an archetype; what beats another deck?"* |
| Market | *"Most expensive card that people actually search for."* |
| Printing prices | *"Is the Secret Rare cheaper than the Ultra? What about KR?"* |
| Paperwork | *"Turn this .ydk into a printable KDE decklist."* |

## Tools

<!-- tools:start -->
**Deck intelligence** — Parse, validate, build and tune 40–60 card lists against a live banlist.

| Tool | What it does |
| --- | --- |
| `ygo_parse_deck` | Parse a `.ydk` file, a `ydke://` link or raw YDK text into a validated deck. |
| `ygo_check_legality` | Check size, banlist and zone legality for a deck in one format. |
| `ygo_export_deck` | Convert a deck to YDK text, a `ydke://` link, or both. |
| `ygo_find_community_decks` | Live community, tournament and Konami recipe decks with page links and ydke. |
| `ygo_find_combos` | Structured published combos (starting cards + steps) by archetype or card. |
| `ygo_find_counters` | Published counter cards, chokepoints and explanations for a deck type. |
| `ygo_compare_decks` | Compare two lists section by section: shared core, only-A, only-B, copy differences. |
| `ygo_find_synergy_and_combos` | Match cards to a stat filter and trace searchers already in your deck. |
| `ygo_build_meta_deck` | Build a legal 40–60 card list for TCG, OCG, AE, Genesys or Master Duel. |
| `ygo_optimize_deck` | Grade staple and hand-trap ratios, then suggest swaps for the format. |
| `ygo_consistency_lab` | Measure playable hands, brick rate and average actions on the real engine. |
| `ygo_matchup_planner` | Turn the live tier list into a field plan and a role-based side deck. |
| `ygo_deck_cost` | Price a deck across markets and show the cheapest combination. |

**Card database** — Search the live card pool by stats, type, race, attribute or archetype.

| Tool | What it does |
| --- | --- |
| `ygo_get_card` | Look a card up by name or passcode, with Yugipedia cross-references. |
| `ygo_card_dossier` | One call for everything about a card: database, wiki, script provenance, rulings. |
| `ygo_search_cards` | Filter the card pool by ATK, DEF, type, race, attribute, level or archetype. |

**Rulings and simulation** — Read the actual ocgcore Lua script instead of guessing from card text.

| Tool | What it does |
| --- | --- |
| `ygo_judge_card` | Read the ocgcore Lua script and report HOPT, costs, targeting and timing. |
| `ygo_analyze_lua` | Parse the Lua structure of ANY card script with an AST (luaparse), not just official ones: effects, condition/cost/target/operation, summon procedures (Fusion/Synchro/Xyz/Link/Pendulum), Effect API calls, constants and simulator-profile warnings. |
| `ygo_script_insights` | Deep script analysis: effect kinds, cost/target/operation pipeline, risks and corpus-wide patterns. |
| `ygo_judge_interaction` | Adjudicate how two named cards interact, citing the rulebook. |
| `ygo_get_rulebook` | Official Konami rulebook: verbatim text with real page citations, plus curated timing guides. |
| `ygo_get_policy` | Official judge corpus: Tournament Policy, Penalties, Fast Effect Timing, Judge FAQ, with page citations. |
| `ygo_wiki` | Yugipedia: cards, sets, products, archetypes, plus Gallery/Rulings/Errata/Tips/Trivia/Appearances tabs. |
| `ygo_judge_scenario` | Run a real duel scenario on ocgcore-wasm and check the judge's expectation against engine evidence. |
| `ygo_ensure_script` | Generate a temporary Lua script for cards without one, verify it in the engine, and auto-replace it when the official script appears. |
| `ygo_verify_ruling` | Check a ruling claim against the engine and return SUPPORTED / CONTRADICTED. |
| `ygo_check_locks` | Detect summon, activation and material locks across a deck and flag conflicts. |
| `ygo_golden_suite` | Replay the golden scenario suite and report which behaviour changed. |
| `ygo_ai_benchmark` | Pit the heuristic duel AI against the passive baseline over seeded games. |
| `ygo_export_selfplay` | Export policy-vs-policy decisions as JSONL training data. |
| `ygo_simulate_duel_scenario` | Walk a board state through a chain and report every legal window. |
| `ygo_run_duel` | Run a REAL duel with ocgcore-wasm (ProjectIgnis EDOPro core compiled to WebAssembly): the engine executes the Lua card scripts, handles chain/cost/target/timing and returns the message timeline (draw, summon, chain, LP update, win). |

**Meta and banlists** — Monthly tier data, month-over-month deltas and daily tournament shifts.

| Tool | What it does |
| --- | --- |
| `ygo_sync_meta` | Refresh staples and banlists from live APIs for every supported format. |
| `ygo_get_monthly_meta` | Monthly tier list, play rates and staple trends per format. |
| `ygo_compare_monthly_meta` | Diff two months of meta data: rising decks, falling decks, banlist impact. |
| `ygo_get_daily_meta` | Daily results, emergency banlist flags and micro-meta shifts. |

**Market and news** — Three markets, one query — rank the whole pool, measure movement, and explain it with news.

| Tool | What it does |
| --- | --- |
| `ygo_check_prices` | TCGPlayer, Yuyu-tei and TCGCorner prices side by side. |
| `ygo_market_query` | Rank the whole pool by price, demand or measured movement, then explain why with news and banlist evidence. |
| `ygo_card_printing_prices` | Per-printing prices by set code, rarity and language — null when no source lists that printing. |
| `ygo_get_news` | Latest reveals and banlist news from the YGOrganization feed. |
| `ygo_get_card_price_trends` | Price history and spread for a single card. |
| `ygo_get_trending_cards` | What the market is buying right now. |

**Tournament paperwork** — Konami-legal decklists and Neuron-style deck images.

| Tool | What it does |
| --- | --- |
| `ygo_generate_tournament_decklist_pdf` | Fill Konami's official KDE decklist form directly. |
| `ygo_render_deck_image` | Render the deck as a 10-per-row Konami Neuron PNG. |

**Custom cards and archetype studio** — Temp IDs, generated Lua, grid artwork, spec documents and database exports.

| Tool | What it does |
| --- | --- |
| `ygo_create_custom_card` | Register an unreleased or fan-made card: temp ID, Lua script and SVG mockup. |
| `ygo_migrate_temp_card` | Move a temp ID to its official passcode across registry, Lua and saved YDK files. |
| `ygo_generate_batch_art_prompt` | Compose a single grid prompt that covers many card artworks. |
| `ygo_slice_batch_art` | Slice a grid image into square artworks and embed them into the card SVGs. |
| `ygo_create_archetype_docx` | Produce a structured archetype specification document. |
| `ygo_read_and_validate_docx` | Read an archetype spec back and validate its structure. |
| `ygo_export_database_and_scripts` | Export the archetype to SQLite plus ocgcore Lua scripts. |
| `ygo_generate_art_prompts` | Generate per-card art prompts from a spec. |
| `ygo_slice_art_grid` | Slice an art grid into card-ready image files. |
| `ygo_build_full_pipeline` | Run spec, scripts, art and export end to end. |
<!-- tools:end -->

Full parameter reference: [docs/TOOLS.md](docs/TOOLS.md).

## Data sources

| Source | Used for | Coverage |
| --- | --- | --- |
| YGOPRODeck | cards, printings, banlists, decks, staples | global |
| TCGCSV / TCGplayer | per-printing EN prices | EN |
| Yuyu-tei | JP OCG listings | JP |
| TCGCorner | AE listings | AE |
| Cardmarket (via YGOPRODeck) | EUR benchmark | EU |
| Master Duel Meta | Master Duel decks, combos, counters | MD |
| Konami Card Database | official deck recipes, card pages | official |
| Format Library | GOAT / Edison / Fiber decks | retro |
| Yugipedia | 12-language names, rulings, tips, trivia | CC BY-SA 3.0 |
| YGOrganization | reveals and banlist news | news |
| YugiohMeta / YGO Omega | TCG/OCG and Genesys tier lists | meta |
| ProjectIgnis | Lua scripts + ocgcore engine | engine |

**Language coverage is explicit.** EN, JP and AE have live price feeds. KR,
DE/FR/IT/SP/PT and SC/TC do not — those tools return `price: null` with a note,
never a substituted US price or a guess from rarity.

## Reliability

- **Every outbound call goes through one HTTP client**: per-host queue, 250 ms
  spacing for TCGCSV, retry with backoff on 429/5xx, `Retry-After` support.
- **Offline mode**: `ygo call <tool> --offline` or `YGO_OFFLINE=1` fails fast with
  an explicit reason; tools report `available: false` instead of hanging.
- **Freshness evidence**: live answers carry a timestamp, a 0–100 score, a badge
  and a SHA-256 hash over the payload, so a stale cache is visible.
- **No telemetry, no accounts, no server.** Deck data never leaves the machine.
- **Path guard**: file-writing tools refuse to write outside the project or a
  recognised simulator install.

## CLI

| Command | Purpose |
| --- | --- |
| `ygo install` / `setup` / `status` / `uninstall` | wire the server into AI clients |
| `ygo serve` | MCP over stdio (`--offline` supported) |
| `ygo tools` / `ygo call <tool>` | inspect and invoke tools without MCP |
| `ygo doctor` | runtime, build, corpora, clients (`--sources`, `--fix`) |
| `ygo cache` | cache sizes and ages; `--clear market --yes` |
| `ygo fetch-data` | download cards.cdb, rulebook, judge corpus, Konami deck form |
| `ygo docs` | regenerate tool tables (`--check` in CI) |
| `ygo stats` / `ygo clean` | local data report / prune old artifacts |

## Architecture

```
src/tools/index.ts        MCP surface — one entry per tool, zod schema = docs
src/core/                 engines
  card-scripts/           Lua AST, judge, ocgcore runtime, scenarios
  card-database/          card pool, dossier, search, combos
  deck-parser/            ydk/ydke, legality
  meta-deck-builder/      templates, live meta, matchup, staples
  pricing/                index, history, printing prices, markets
  deck-community/         YGOPRODeck / MDM / Konami / Format Library
  news-rulings/           rulebook, policy corpus, YGOrganization, citations
  custom-cards/           registry, Lua generator, renderer
  deck-export/            KDE PDF + Neuron-style PNG (Python)
src/cli/                  installer, shell interface, docs generator
skills/                   agent-facing SKILL.md
```

Deep dive (data flow, algorithms, failure modes): **[docs/TECHNICAL.md](docs/TECHNICAL.md)**.

## Development

```bash
npm run build          # tsc → dist/
npm test               # end-to-end suites (network required)
npm run test:http      # retry/backoff/rate-limit contract (offline)
npm run test:fixtures  # parser tests against synthetic responses (offline)
npm run test:compare   # deck comparison unit tests
npm run test:pack      # pack → install in a temp dir → MCP handshake
npm run docs           # regenerate tool tables
npm run doctor         # environment check
```

Adding a tool: append to `TOOLS` in [`src/tools/index.ts`](src/tools/index.ts),
give it a category in [`src/cli/tooling.ts`](src/cli/tooling.ts), then
`npm run build && npm run docs`. The README table, both tool references and
`ygo tools` all regenerate from that one array.

## Takedown & consent

This is a non-commercial fan project, not affiliated with Konami Digital
Entertainment, Shueisha, TV Tokyo or Studio Dice. **If you are a rights holder and
believe this repository, its documentation or the published npm package infringes
your rights, open an issue or a private security advisory — the maintainer will
remove the repository and the npm package promptly, no legal action required.**
See [NOTICE](NOTICE) for the third-party material and the licence boundaries.

## Project

- npm: <https://www.npmjs.com/package/yugioh-assistant-mcp>
- GitHub: <https://github.com/SPdream99/yugioh-assistant-mcp>
- [Security policy](SECURITY.md) — private reporting, scope, data handling.
- [Third-party notice](NOTICE) — downloaded Konami form, ProjectIgnis procedures, synthetic fixtures, trademarks.
- [Changelog](CHANGELOG.md) — what changed in 0.9.4.

## License & credits

**Code: [AGPL-3.0-only](LICENSE).** You may use, modify and redistribute it under
the AGPL; derivative works distributed or offered over a network must keep the
same licence. The licence permits commercial use by others — this project itself
is run as a non-commercial fan utility and is not affiliated with Konami Digital
Entertainment, Shueisha, TV Tokyo or Studio Dice. Yu-Gi-Oh! and all related marks
belong to their respective owners.

The Konami deck-list form (`data/templates/KDE_DeckList.pdf`) is **not bundled**;
`ygo fetch-data` downloads it from Konami on demand, or you can point
`YGO_KDE_TEMPLATE` at your own copy. Full terms: [docs/LEGAL.md](docs/LEGAL.md).
Sources and open-source libraries: [docs/CREDITS.md](docs/CREDITS.md).
