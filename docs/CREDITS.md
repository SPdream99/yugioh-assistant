# Credits & data sources

This project is a fan-made, non-commercial utility. It would not exist without the
people and projects below. Nothing in this repository is affiliated with, endorsed
by, or sponsored by Konami Digital Entertainment, Shueisha, TV Tokyo or Studio Dice.

**How third-party data is used.** Every source is queried read-only at runtime.
Responses are cached locally under `data/` and are never bundled into the npm
package (except the Konami KDE deck-list PDF template, which ships as a blank form).
No source is mirrored, resold or redistributed.

---

## Card data, rulings and rules

| Source | What it powers | Notes |
| --- | --- | --- |
| [YGOPRODeck API](https://ygoprodeck.com/api-guide/) | Card records, printings, prices, banlists, archetypes, staple lists, weekly views | Free public API; this project is not affiliated with it |
| [Yugipedia](https://yugipedia.com/) (MediaWiki API) | 12-language names, rulings/errata/tips/trivia/gallery tabs, set lists | Text is licensed **CC BY-SA 3.0**; every wiki answer carries the source URL and the licence |
| [Konami Official Card Database / Neuron](https://www.db.yugioh-card.com/yugiohdb/) | Public deck recipes, official card pages | Queried with a session token, one page per recipe; official marks belong to Konami |
| [Konami rulebook](https://www.yugioh-card.com/en/rulebook/) | Verbatim rulebook text with printed page citations | Downloaded on demand, not redistributed |
| [Konami judge corpus](https://www.yugioh-card.com/en/) (KDE-US/KDE-EU policy, penalties, PSCT, Fast Effect Timing, Judge FAQ) | `ygo_get_policy` citations | Downloaded on demand; versions and pages are reported with every hit |
| [ProjectIgnis CardScripts](https://github.com/ProjectIgnis/CardScripts) | The `c<passcode>.lua` scripts every ruling is based on | Scripts are fetched on demand; generated scripts are clearly labelled and never override official ones |
| [ocgcore / EDOPro](https://github.com/ProjectIgnis/EDOPro) via [ocgcore-wasm](https://www.npmjs.com/package/ocgcore-wasm) | Real duel execution, scenario verification, consistency lab, AI self-play | Engine behaviour is the final arbiter in `ygo_judge_scenario` / `ygo_verify_ruling` |
| [BabelCDB](https://github.com/ProjectIgnis/BabelCDB) | `cards.cdb` downloaded by `ygo fetch-data` | Not bundled with the package |

## Market and price data

| Source | What it powers | Notes |
| --- | --- | --- |
| [TCGplayer](https://www.tcgplayer.com/) | US reference prices | Reached through TCGCSV and YGOPRODeck aggregates |
| [TCGCSV](https://tcgcsv.com/) | **Per-printing** EN prices (Number + Rarity + market price) | Uses the custom User-Agent and request pacing requested in the [TCGCSV guidelines](https://tcgcsv.com/docs#usage-guidelines); responses are cached for hours |
| [Cardmarket](https://www.cardmarket.com/) | EUR benchmark when no AE listing exists | Labelled as a benchmark, never presented as a TCGCorner listing |
| [Yuyu-tei](https://yuyu-tei.jp/) | JP OCG listings (set code + rarity + yen) | Queried with the Japanese card name; no listing means `price: 0` + search link, never a guessed number |
| [TCGCorner](https://tcgcorner.com/) | AE (Asian-English) Shopify listings | Product titles are matched to the card before a price is shown |
| [Format Library](https://www.formatlibrary.com/) | Retro/community format decks (GOAT, Edison, Fiber) | Uses the public deck API, which returns a ready `ydk` |

**Language coverage is explicit.** EN, JP and AE have live price feeds. KR,
DE/FR/IT/SP/PT and SC/TC do **not** — the tools say so and return `price: null`
instead of substituting a US price.

## Meta, decks, combos and news

| Source | What it powers | Notes |
| --- | --- | --- |
| [YGOPRODeck deck search](https://ygoprodeck.com/deck-search/) | Community + curated tournament decks, category taxonomy | Public JSON used by their own search page |
| [Master Duel Meta](https://www.masterduelmeta.com/) | Master Duel tier data, top decks, deck types, combos, counters | Public JSON endpoints; `impact` labels are community opinions, not win rates |
| [YugiohMeta](https://www.yugiohmeta.com/) | TCG/OCG tier lists | Cited with freshness evidence |
| [YGO Omega wiki](https://omega.duelistsunite.org/) | Genesys ladder tier table | Parsed from the published table |
| [YGOrganization](https://ygorganization.com/) | New card reveals, banlist news, tournament coverage | RSS feed, linked back in every answer |

## Reference projects

- [alisyedn/yugioh-mcp-server](https://github.com/alisyedn/yugioh-mcp-server) — early reference for wiring YGOPRODeck into an MCP server.
- [YGOProxy](https://ygoproxy.com/) — proxy print-format conventions used by the deck renderer.

## Open-source libraries

Node / TypeScript:

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server and stdio transport.
- [zod](https://zod.dev/) — tool schemas (which double as the generated documentation).
- [axios](https://axios-http.com/) — HTTP client.
- [luaparse](https://github.com/fstirlitz/luaparse) — Lua AST used by the judge/analyzer.
- [ocgcore-wasm](https://www.npmjs.com/package/ocgcore-wasm) — the duel engine compiled to WebAssembly.
- [node-sqlite3-wasm](https://www.npmjs.com/package/node-sqlite3-wasm) — reading `cards.cdb` without native builds.
- [pdfjs-dist](https://mozilla.github.io/pdf.js/) — rulebook/policy PDF text extraction.
- [TypeScript](https://www.typescriptlang.org/), [tsx](https://github.com/privatenumber/tsx), [Node.js](https://nodejs.org/).

Python (PDF and image tooling only):

- [python-docx](https://python-docx.readthedocs.io/) — archetype specification documents.
- [Pillow](https://python-pillow.org/) — deck image rendering and art slicing.
- [reportlab](https://www.reportlab.com/) — PDF generation helpers.

## Related projects consulted

This project was developed with reference to many related open-source projects. They
were read to compare approaches, data shapes and conventions; no code from an
unlisted project is included, and the only code that ships is the dependency set
below plus this repository.

- **Yu-Gi-Oh! MCP servers and AI assistants** — for tool surfaces, prompt policy and MCP wiring (for example [alisyedn/yugioh-mcp-server](https://github.com/alisyedn/yugioh-mcp-server)).
- **Deck builders, price trackers and ruling tools** — for decklist formats, legality checks, pricing fields and ruling presentation.
- **Simulator and script projects** — [ProjectIgnis/EDOPro](https://github.com/ProjectIgnis/EDOPro), [ProjectIgnis/CardScripts](https://github.com/ProjectIgnis/CardScripts), [YGOProxy](https://ygoproxy.com/) — for engine behaviour, procedure libraries and proxy print conventions.
- **MCP infrastructure** — the [MCP specification](https://modelcontextprotocol.io), the official registry, `awesome-mcp-servers` and Glama — for discovery, manifests and health checks.

If a project believes this repository borrows too heavily from its work, open an
issue and the relevant part will be rewritten or removed.

## Attribution rules this project follows

1. **Yugipedia** content is CC BY-SA 3.0. Wiki answers include the source URL and the licence string; downstream reuse must keep the same licence.
2. **TCGCSV** asks for a custom User-Agent and modest request rates. This project identifies itself as `yugioh-assistant-mcp/<version>` and caches responses.
3. **Yuyu-tei / TCGCorner** are queried only for a single named card, never bulk-crawled.
4. **Konami** documents are downloaded on demand and quoted with page numbers, never rebundled.
5. **No price is inferred from rarity.** If a source does not list a printing, the answer is `null`.

If you are a rights holder and want something removed, see [LEGAL.md](LEGAL.md) —
the project commits to immediate takedown on a legitimate request.

---
