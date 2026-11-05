# Tool reference

54 MCP tools, generated from `src/tools/index.ts` by `ygo docs`. Do not edit by hand.

> Version 0.9.4

## Deck intelligence

Parse, validate, build and tune 40–60 card lists against a live banlist.

### `ygo_parse_deck`

Parse a `.ydk` file, a `ydke://` link or raw YDK text into a validated deck.

<sub>USE THIS FIRST when the user supplies a .ydk path, raw .ydk text or a ydke:// link. Parse the deck into card data and validate it; never transcribe the list by hand. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `ydkContent` | `string` | no | Raw .ydk text |
| `filePath` | `string` | no | Absolute or relative path to a .ydk file |
| `ydkeUrl` | `string` | no | ydke:// link (e.g. ydke://base64!base64!base64!) |
| `name` | `string` | no | Deck name |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Banlist used to validate copy limits (default TCG) (default `"TCG"`) |

### `ygo_check_legality`

Check size, banlist and zone legality for a deck in one format.

<sub>USE THIS for every "is this legal / how many copies can I run / is X banned" question. Checks Main/Extra/Side sizes, banlist copy limits for the requested format (forbidden / limited / semi-limited), and that Fusion/Synchro/Xyz/Link monsters are only in the Extra Deck. Works from a .ydk path, raw .ydk text, a ydke:// link, or a DeckData object. Never state a banlist status from memory. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deck` | `any` | no | DeckData, a .ydk path, raw .ydk text, a ydke:// link, or a plain card list |
| `input` | `string` | no | Alias for deck (a .ydk path, .ydk text or ydke:// link) |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Banlist format (default `"TCG"`) |

### `ygo_export_deck`

Convert a deck to YDK text, a `ydke://` link, or both.

<sub>Export a deck as .ydk text, a canonical ydke:// link, or both.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deck` | `any` | yes | Deck data { main: number[], extra: number[], side: number[] } |
| `format` | `"ydk" | "ydke" | "both"` | no | Output format (default `"both"`) |

### `ygo_find_community_decks`

Live community, tournament and Konami recipe decks with page links and ydke.

<sub>USE THIS when the user wants real decklists that other people published ("show me decks for an archetype", "what are people building", "a tournament list", "official Konami recipe"). Pulls live community/tournament decks from YGOPRODeck, Master Duel Meta and Konami's official card database (Neuron), and returns each deck's canonical page URL plus a ready-to-use ydke:// link. Every deck plugs straight into ygo_check_legality, ygo_deck_cost, ygo_consistency_lab or ygo_optimize_deck — do not retype the list by hand. Never invent a community deck or a deck URL. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | `string` | no | Free-text name/card keyword, e.g. an archetype name |
| `archetype` | `string` | no | Archetype / deck-type filter |
| `category` | `string` | no | YGOPRODeck category taxonomy: 'type/<archetype-slug>', a full /category/type/... URL, or a bare archetype. Resolves to their _sft_post_tag filter. |
| `tournament` | `string` | no | Tournament name filter, e.g. 'YCS Providence' |
| `deckSize` | `number` | no | Exact Main Deck size filter (e.g. 40) |
| `minPrice` | `number` | no | Minimum deck price in USD (source-reported) |
| `maxPrice` | `number` | no | Maximum deck price in USD (source-reported) |
| `from` | `string` | no | Only decks submitted on/after this date (YYYY-MM-DD) |
| `to` | `string` | no | Only decks submitted on/before this date (YYYY-MM-DD) |
| `containsCard` | `string` | no | Only decks that contain this card (name resolved to a passcode) |
| `excludeCard` | `string` | no | Exclude decks that contain this card |
| `format` | `string` | no | Format filter: tcg \| ocg \| ae \| genesys \| meta \| casual \| master duel. Passed to the source's own category filter. |
| `source` | `"all" | "ygoprodeck" | "masterduelmeta" | "konami" | "formatlibrary"` | no | YGOPRODeck = TCG/OCG community + curated tournament decks; Master Duel Meta = Master Duel decks; konami = official card-database deck recipes (needs a query); formatlibrary = retro/community formats (GOAT, Edison, Fiber). Defaults to ygoprodeck when a YGOPRODeck-only filter is used. |
| `sort` | `"popular" | "recent" | "comments"` | no | Sort order (default `"popular"`) |
| `limit` | `number` | no | Decks per source (1-20) (default `5`) |
| `offset` | `number` | no | Paging offset for YGOPRODeck (default `0`) |
| `includeNames` | `boolean` | no | Resolve passcodes to card names (larger payload) (default `false`) |
| `includeCombos` | `boolean` | no | Attach structured combos for the archetype from Master Duel Meta's public combo API (default `true`) |

### `ygo_find_combos`

Structured published combos (starting cards + steps) by archetype or card.

<sub>USE THIS for "how does this deck combo / what is the line" questions that need real combo data. Returns structured combos (starting cards + ordered steps) from Master Duel Meta's public combo API, filtered by archetype or by a specific card, each with a source URL. For a combo derived from a list you already hold, pass the deck to ygo_find_synergy_and_combos instead — this tool reports published combos, it does not invent them. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `archetype` | `string` | no | Archetype / deck type (e.g. a deck type name) |
| `card` | `string` | no | Card name to find combos that use it (searches the 300 newest public combos) |
| `limit` | `number` | no | Max combos (1-30) (default `10`) |

### `ygo_find_counters`

Published counter cards, chokepoints and explanations for a deck type.

<sub>USE THIS for "how do I beat this deck / what counters it / which card stops this combo". Returns published counter strategies from Master Duel Meta (counter cards with impact, chokepoints, and the author's explanation), filtered by archetype or by a card that appears as a counter. Each entry carries a source URL. This is community evidence, not a ruling — verify card behaviour with ygo_judge_card. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `archetype` | `string` | no | Deck type to counter (e.g. a deck type name) |
| `card` | `string` | no | Card name used as a counter/chokepoint, to find decks it answers |
| `limit` | `number` | no | Max counter entries (1-20) (default `5`) |

### `ygo_compare_decks`

Compare two lists section by section: shared core, only-A, only-B, copy differences.

<sub>USE THIS for "what do these two lists share", "core vs tech", or comparing a community deck with your own. Compares two decks section by section (Main/Extra/Side) and returns shared cards, cards only in A or B, and copy-count differences with an overlap percentage. Accepts .ydk paths, raw .ydk text, ydke:// links or DeckData. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deckA` | `any` | yes | First deck: .ydk path, raw .ydk text, ydke:// link or DeckData |
| `deckB` | `any` | yes | Second deck: same accepted shapes |

### `ygo_find_synergy_and_combos`

Match cards to a stat filter and trace searchers already in your deck.

<sub>USE THIS for "find a card that does X" or "how do I search it" questions. Find monsters/cards by concrete stats (e.g. 1850 ATK Spellcaster), match them against your deck's existing searchers, and output the combo line. Do not invent search targets from memory. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `filter` | `object` | yes |  |
| `deck` | `any` | no | DeckData, or .ydk / ydke:// content |
| `desiredPayoff` | `string` | no | Desired role: negate, floodgate, disruption, draw, recur (default `"disruption"`) |

### `ygo_build_meta_deck`

Build a legal 40–60 card list for TCG, OCG, AE, Genesys or Master Duel.

<sub>USE THIS whenever the user asks you to build, produce or suggest a decklist. Build a tournament-legal deck (40-60 Main, up to 15 Extra, 15 Side) that respects the banlist of the chosen format (TCG, OCG, AE, Genesys, Master Duel), with strategy, staples and a legal list. Every generated list is re-validated (banlist, sizes, Extra Deck placement) before it is returned. If the archetype has no template the tool returns available:false plus availableArchetypes — it never substitutes another deck. Never output a decklist from memory; every card must come from this tool's response.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `archetype` | `string` | yes | Archetype name (e.g. an archetype) |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Format (TCG, OCG, Asian-English AE, Genesys, Master Duel) (default `"TCG"`) |
| `goSecond` | `boolean` | no | Play second (blind 2nd) |
| `targetCount` | `number` | no | Desired Main Deck size (40-60 cards) (default `40`) |

### `ygo_optimize_deck`

Grade staple and hand-trap ratios, then suggest swaps for the format.

<sub>USE THIS when the user asks to upgrade, fix or grade an existing deck. Grade the staple / hand-trap / board-breaker ratio and propose upgrades under the current banlist and meta. Do not propose replacement cards from memory; start from this tool's output. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deck` | `any` | yes | DeckData, a .ydk file path, raw .ydk text, a ydke:// link, or a plain card list |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Format (TCG, OCG, AE, Genesys, Master Duel) (default `"TCG"`) |

### `ygo_consistency_lab`

Measure playable hands, brick rate and average actions on the real engine.

<sub>Measure what a deck's opening hands actually do. Deals seeded hands through the real ocgcore engine with a goldfish responder and reports two distinct numbers: anyActionRate (at least one legal action — a very low bar) and engineBoardRate (reached the Extra Deck or kept a monster on the field). Also returns summon/Extra Deck rates, average board size and the most common openers. A measurement, not a win-rate prediction.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `string` | no | Deck as ydke:// link, .ydk content/path or a text card list |
| `main` | `number | string[]` | no | Main Deck passcodes/names instead of a deck |
| `extra` | `number | string[]` | no | Extra Deck passcodes/names |
| `trials` | `number` | no | Opening hands to test (1-200). Above 200 the tool refuses rather than silently clamping. (default `15`) |
| `seed` | `number` | no | Deterministic seed (default `12345`) |
| `maxSteps` | `number` | no | Engine steps per trial (raise it to see longer combo lines) (default `40`) |
| `opponentMain` | `number | string[]` | no | Opponent Main Deck passcodes/names (defaults to a mirror of your deck; the goldfish opponent never draws) |

### `ygo_matchup_planner`

Turn the live tier list into a field plan and a role-based side deck.

<sub>Turn the live tier list into a field plan: expected frequency by tops, the top decks to prepare for, and a role-based 15-card side skeleton from the format's staple pool. Counter choices are labelled as role heuristics, not proven counters.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Format (default `"TCG"`) |
| `deckName` | `string` | no | Your deck, for context |
| `sideSize` | `number` | no | Side Deck size (1-15) (default `15`) |

### `ygo_deck_cost`

Price a deck across markets and show the cheapest combination.

<sub>Price a whole deck across TCGPlayer / Yuyu-tei / TCGCorner, show the cheapest market per card and the potential saving versus the most expensive market. Prices a bounded number of unique cards and marks the result partial rather than inventing numbers (no FX or shipping applied).</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `string` | no | Deck as ydke:// link, .ydk content/path or a text card list |
| `cards` | `object[]` | no | Explicit card list with copy counts |
| `maxCards` | `number` | no | Maximum unique cards to price (1-30) (default `15`) |
| `timeBudgetMs` | `number` | no | Stop early after this many milliseconds (default `45000`) |

## Card database

Search the live card pool by stats, type, race, attribute or archetype.

### `ygo_get_card`

Look a card up by name or passcode, with Yugipedia cross-references.

<sub>USE THIS for every individual card fact: name, passcode, ATK/DEF, Level, attribute, type, effect text or banlist status. Look up one card by name or passcode. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | no | Card name (English) |
| `id` | `number` | no | Card passcode (8 digits) |

### `ygo_card_dossier`

One call for everything about a card: database, wiki, script provenance, rulings.

<sub>USE THIS FIRST for a full card profile (database record + wiki + script provenance + optional rulings/prices). One call for everything about a card: official database record (stats, text), wiki record (names in 12 languages, Yu-Gi-Oh! Card Database ID, which tabs exist, page URL), script provenance (official/custom/generated/missing), and optional rulings summary and cached prices. Reports per-source status so a partial answer is explicit. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | no | Card name (English) |
| `passcode` | `number` | no | Card passcode |
| `includeRulings` | `boolean` | no | Include a rulings summary from the wiki (extra request) (default `false`) |
| `includePrices` | `boolean` | no | Include cached market prices (default `false`) |

### `ygo_search_cards`

Filter the card pool by ATK, DEF, type, race, attribute, level or archetype.

<sub>USE THIS whenever the task is card discovery (ATK, DEF, type, race, attribute, level, archetype, effect text) or a price-ranked list ("most expensive Dragon", "Spellcasters under $5"). Search the live card pool; do not list candidate cards from memory. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | no | Card name containing the keyword |
| `type` | `string` | no | Card type: Normal Monster, Effect Monster, Spell Card, Trap Card, Link Monster,... |
| `race` | `string` | no | Race: Spellcaster, Dragon, Warrior, Fiend, Cyberse, Pyro, ... |
| `attribute` | `string` | no | Attribute: LIGHT, DARK, FIRE, WATER, EARTH, WIND, DIVINE |
| `level` | `number` | no | Level / Rank |
| `atk` | `number` | no | Exact ATK |
| `def` | `number` | no | Exact DEF |
| `minAtk` | `number` | no | Minimum ATK |
| `maxAtk` | `number` | no | Maximum ATK |
| `archetype` | `string` | no | Archetype name (e.g. an archetype) |
| `desc` | `string` | no | Keyword present in the effect text |
| `minPrice` | `number` | no | Minimum USD market price (switches to the market index) |
| `maxPrice` | `number` | no | Maximum USD market price (switches to the market index) |
| `sortBy` | `"price_desc" | "price_asc" | "demand" | "liquidity_adjusted" | "release_desc" | "name_asc"` | no | Sort order. price_* / demand / liquidity_adjusted require the market index; release_desc = newest TCG release first |
| `limit` | `number` | no | Max results (1-50) (default `20`) |

## Rulings and simulation

Read the actual ocgcore Lua script instead of guessing from card text.

### `ygo_judge_card`

Read the ocgcore Lua script and report HOPT, costs, targeting and timing.

<sub>USE THIS for every ruling question about a specific card. Full mechanics adjudication from the ProjectIgnis Lua source: HOPT/SOPT, cost vs effect, targeting, miss timing, Damage Step, negate activation vs negate effect. Accepts a passcode or a card name, reports the script provenance (official/custom/generated/missing) and attaches rulebook + PSCT citations. Do not assert a ruling from memory. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `passcode` | `number` | no | Card passcode |
| `cardName` | `string` | no | Card name (used to resolve the passcode when 'passcode' is omitted) |

### `ygo_analyze_lua`

Parse the Lua structure of ANY card script with an AST (luaparse), not just official ones: effects, condition/cost/target/operation, summon procedures (Fusion/Synchro/Xyz/Link/Pendulum), Effect API calls, constants and simulator-profile warnings.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `luaCode` | `string` | no | Raw Lua script content |
| `luaPath` | `string` | no | Absolute/relative path to a .lua file |
| `passcode` | `number` | no | Passcode to cross-reference (default 0) |
| `includeApiCalls` | `boolean` | no | Include every API call (may be long) (default `false`) |
| `deep` | `boolean` | no | Also return the deep insight layer: effect kinds, cost/target/operation pipeline, count limits, risks and complexity (default `false`) |

### `ygo_script_insights`

Deep script analysis: effect kinds, cost/target/operation pipeline, risks and corpus-wide patterns.

<sub>Deep card-script analysis. `card` mode explains every effect: kind (ignition/trigger/quick/continuous/flip/summon), trigger event, whether the condition/cost/target/operation pipeline is complete, what it costs, whether it targets, reset duration, hard/soft/duel once-per-turn, plus structural risks (missing LoadScript, invalid constants, target without operation, skeleton code) and complexity metrics. `corpus` mode aggregates a whole folder of scripts: effect-kind distribution, most common trigger events and categories, count-limit mix, recurring risks and the worst offenders.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `mode` | `"card" | "corpus"` | no | card = one script; corpus = aggregate a folder (default `"card"`) |
| `passcode` | `number` | no | Card passcode (card mode) |
| `cardName` | `string` | no | Card name, resolved to a passcode (card mode) |
| `luaCode` | `string` | no | Raw Lua (card mode) |
| `luaPath` | `string` | no | Path to a .lua file (card mode) |
| `dir` | `string` | no | Folder of c<id>.lua files (corpus mode; defaults to the cached official scripts) |
| `limit` | `number` | no | Maximum scripts to scan in corpus mode (default `200`) |

### `ygo_judge_interaction`

Adjudicate how two named cards interact, citing the rulebook.

<sub>Official ruling on the interaction between two specific cards, grounded in the ocgcore engine and the Konami rulebook.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `cardA` | `string` | yes | Name or passcode of card A |
| `cardB` | `string` | yes | Name or passcode of card B |
| `question` | `string` | yes | Scenario description or interaction question |

### `ygo_get_rulebook`

Official Konami rulebook: verbatim text with real page citations, plus curated timing guides.

<sub>Official Konami rulebook (PDF from yugioh-card.com/en/rulebook/): verbatim text with printed page citations. Topics: status, official, search, section, page. The timing/damage_step/segoc/mechanics topics are curated summaries, not official text.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `topic` | `"status" | "official" | "search" | "section" | "page" | "timing" | "damage_step" | "segoc" | "mechanics"` | yes | status = loaded rulebook state; official/search = verbatim text with page numbers; section = full section; page = full page; timing/damage_step/segoc/mechanics = curated summaries |
| `query` | `string` | no | Question or keyword (for topic official/search/column) |
| `page` | `number` | no | Printed page number to read in full (for topic page) |
| `term` | `string` | no | Specific term (for topic mechanics) |
| `refresh` | `boolean` | no | Re-download the latest PDF from Konami before answering (default `false`) |

### `ygo_get_policy`

Official judge corpus: Tournament Policy, Penalties, Fast Effect Timing, Judge FAQ, with page citations.

<sub>Official Konami judge corpus: Tournament Policy (KDE-US), Tournament Infractions & Penalties, Speed Duel/Remote Duel addenda, Fast Effect Timing, Advanced Rules, PSCT series, Judge Program and Judge FAQ. Verbatim text with document, version and page citations.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `topic` | `"status" | "list" | "search" | "section" | "page"` | yes | status = corpus state; list = document list; search = verbatim text with citations; section = a full section; page = a full page |
| `query` | `string` | no | Question/keyword (search) or section title (section) |
| `document` | `string` | no | Document ID: tournament-policy, penalties, speed-duel-addendum, remote-duel-addendum, remote-duel-guide, fast-effect-timing, advanced-rules, rules-update-2021, judge-program, judge-faq |
| `page` | `number` | no | Page number (topic=page) |
| `refresh` | `boolean` | no | Re-sync the latest documents from Konami (default `false`) |

### `ygo_wiki`

Yugipedia: cards, sets, products, archetypes, plus Gallery/Rulings/Errata/Tips/Trivia/Appearances tabs.

<sub>Yugipedia lookup: cards (names in 12 languages, passcode, Yu-Gi-Oh! Card Database ID, archetype, which tabs exist), tabs (Gallery / Rulings / Errata / Artworks / Tips / Trivia / Appearances / Names / Lores), pages (sets, products, archetypes) and search. Resolves by name, passcode or database ID.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `topic` | `"card" | "tab" | "page" | "search" | "status"` | yes | card = card info; tab = Gallery/Rulings/... subpage; page = set/product/archetype; search = find a page; status = cache |
| `input` | `string` | no | Card name / passcode / database ID / page title (e.g. 46986414, 22132, or a page title) |
| `tab` | `"gallery" | "rulings" | "errata" | "artworks" | "tips" | "trivia" | "appearances" | "names" | "lores"` | no | Subpage to read (topic=tab) |
| `section` | `string` | no | Section title within the page (e.g. 'Other languages', 'Playing style') |
| `query` | `string` | no | Search keyword (topic=search) |
| `imagesOnly` | `boolean` | no | Return only the image list (useful for gallery/artworks) (default `false`) |
| `refresh` | `boolean` | no | Bypass the 7-day cache and reload (default `false`) |

### `ygo_judge_scenario`

Run a real duel scenario on ocgcore-wasm and check the judge's expectation against engine evidence.

<sub>Run a REAL duel scenario on ocgcore-wasm, then check the judge's expectations against the engine and conclude. Returns verdict (CONFIRMED/REFUTED/INCONCLUSIVE), the actual chain link by link, the action transcript, engine evidence per expectation, final field/LP, and rulebook/policy citations. Presets cover the common negate and protection cases.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `preset` | `"negate-protected" | "negate-unprotected" | "hopt-after-negate" | "draw-blocked"` | no | Run a built-in preset scenario |
| `scenario` | `string` | no | JSON of a custom ScenarioSpec: { name, description, handA, handB, deckA, deckB, extraA, extraB, decisions, expect } |
| `citations` | `boolean` | no | Attach relevant rulebook/policy citations (default `true`) |
| `deck` | `string` | no | Player A deck as ydke:// link, .ydk content/path or a text card list (used when the scenario omits deckA) |
| `opponentDeck` | `string` | no | Player B deck as ydke:// link, .ydk content/path or a text card list (used when the scenario omits deckB) |
| `board` | `string` | no | Board notation instead of a JSON scenario, e.g. 'A hand: Card A' + 'A: activate "Card A"' + 'expect: summoned "Card A"' |
| `maxSteps` | `number` | no | Maximum engine steps (default `200`) |

### `ygo_ensure_script`

Generate a temporary Lua script for cards without one, verify it in the engine, and auto-replace it when the official script appears.

<sub>Manage Lua scripts for cards that have no official one. `from-news` reads a reveal article (e.g. YGOrganization), extracts the card name, artwork URLs, text and stats, assigns a temporary ID and generates the script; `resolve` generates from the cards.cdb text when the card is already in the database. Every generated script is verified by loading it into ocgcore and is automatically replaced by the official ProjectIgnis script as soon as one exists. Returns provenance (manual/custom/official/generated), confidence, recognised patterns, engine errors and the replacedGenerated flag.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `topic` | `"resolve" | "from-news" | "upgrade" | "inventory" | "list"` | yes | resolve = fetch/generate a script for one card; from-news = read a reveal article, extract the card and generate its script; upgrade = sweep every generated script and replace it if an official one exists; inventory = counts; list = generated scripts |
| `passcode` | `number` | no | Card passcode (required for topic=resolve) |
| `url` | `string` | no | Article URL for topic=from-news (e.g. a YGOrganization reveal post) |
| `cardName` | `string` | no | Override the card name extracted from the article |
| `tempId` | `number` | no | Temporary ID to assign (defaults to the next free 990000000+ value) |
| `allowGenerate` | `boolean` | no | Allow generating a script when no official one exists (default `true`) |
| `refreshOfficial` | `boolean` | no | Bypass the cache and check ProjectIgnis now (default `false`) |
| `skipVerify` | `boolean` | no | Skip engine verification (faster, but not guaranteed to run) (default `false`) |

### `ygo_verify_ruling`

Check a ruling claim against the engine and return SUPPORTED / CONTRADICTED.

<sub>USE THIS before asserting any ruling you cannot point at engine evidence for. Verify a ruling CLAIM against the engine. Give a sentence ('Card A negates Card B') and the tool picks a matching scenario (or runs the one you pass), executes it on ocgcore and returns SUPPORTED / CONTRADICTED / INCONCLUSIVE with the observation that decided it. This is how a judge conclusion becomes checkable. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `claim` | `string` | yes | The ruling claim to verify, e.g. 'Card A negates Card B' |
| `scenario` | `string` | no | Optional ScenarioSpec JSON to run instead of an auto-selected preset |
| `scenarioId` | `string` | no | Optional preset id (see ygo_judge_scenario) |

### `ygo_check_locks`

Detect summon, activation and material locks across a deck and flag conflicts.

<sub>Detect summon/activation/material locks in the cards of a deck and flag contradictions. Reads the Lua scripts and reports which card locks you into (or out of) which Summon type, plus conflicts such as a Special Summon lock next to an Extra Deck lock.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `string` | no | Deck as ydke:// link, .ydk content/path or a text card list |
| `passcodes` | `number | string[]` | no | Card list instead of a deck |
| `maxCards` | `number` | no | Maximum cards to inspect (default `20`) |

### `ygo_golden_suite`

Replay the golden scenario suite and report which behaviour changed.

<sub>Run the golden regression suite: every stored scenario is replayed on ocgcore and compared with its expected outcome. Use after a ProjectIgnis script update or an engine bump to see exactly which behaviour changed.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `only` | `string[]` | no | Run only these case ids |
| `file` | `string` | no | Alternative golden file path |

### `ygo_ai_benchmark`

Pit the heuristic duel AI against the passive baseline over seeded games.

<sub>Benchmark the heuristic duel AI against the engine's passive default responder over N seeded games, alternating the starting side. Returns win rates, average game length and LP remaining. The AI is a policy, not a trained model — treat the number as a sanity check.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deckA` | `number | string[]` | yes | Main Deck A (passcodes or names) |
| `deckB` | `number | string[]` | yes | Main Deck B (passcodes or names) |
| `extraA` | `number | string[]` | no |  |
| `extraB` | `number | string[]` | no |  |
| `games` | `number` | no | Games to play (1-50) (default `10`) |
| `seed` | `number` | no | Seed (default `1`) |
| `aiSide` | `"A" | "B" | "alternate"` | no | Which side uses the AI (default `"alternate"`) |
| `maxSteps` | `number` | no | Engine steps per game (default `120`) |
| `startingLP` | `number` | no | Starting LP (2000 finishes benchmarks faster) (default `8000`) |
| `exploration` | `number` | no | Policy randomness (0-1) (default `0.1`) |

### `ygo_export_selfplay`

Export policy-vs-policy decisions as JSONL training data.

<sub>Play policy-vs-policy games on the real engine and export every decision as JSONL (request type, legal option codes, chosen action, result). This is the training-data generator for behavioural cloning / reinforcement learning.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deckA` | `number | string[]` | yes | Main Deck A |
| `deckB` | `number | string[]` | yes | Main Deck B |
| `extraA` | `number | string[]` | no |  |
| `extraB` | `number | string[]` | no |  |
| `games` | `number` | no | Games (1-50) (default `5`) |
| `seed` | `number` | no | Seed (default `1`) |
| `maxSteps` | `number` | no | Engine steps per game (default `120`) |
| `outPath` | `string` | no | Output .jsonl path (defaults to data/ai/) |

### `ygo_simulate_duel_scenario`

Walk a board state through a chain and report every legal window.

<sub>Analyse a duel scenario in text form: chain order, legality of each activation, cost/target/timing checks, Lua script cross-reference and a judge-style verdict. Heuristic only — use ygo_judge_scenario or ygo_run_duel for real engine execution.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `scenario` | `string` | yes | Duel scenario description (e.g. 'Player A activates Card A, Player B chains Card B discarding it, Player A chains Card C targeting Card B in the GY...') |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Format (default `"TCG"`) |
| `initialState` | `string` | no | Initial board state or hand/Graveyard, if any |
| `deckA` | `number[]` | no | Player A Main Deck (passcodes). With deckA+deckB the real ocgcore-wasm engine runs. |
| `deckB` | `number[]` | no | Main Deck Player B (passcodes) |
| `handA` | `number[]` | no | Hand Player A (passcodes) |
| `handB` | `number[]` | no | Hand Player B (passcodes) |
| `extraA` | `number[]` | no | Extra Deck Player A (passcodes) |
| `extraB` | `number[]` | no | Extra Deck Player B (passcodes) |
| `maxSteps` | `number` | no | Maximum engine steps (default `120`) |
| `startingLP` | `number` | no | Starting LP (default `8000`) |

### `ygo_run_duel`

Run a REAL duel with ocgcore-wasm (ProjectIgnis EDOPro core compiled to WebAssembly): the engine executes the Lua card scripts, handles chain/cost/target/timing and returns the message timeline (draw, summon, chain, LP update, win).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `deckA` | `number | string[]` | no | Main Deck Player A (passcodes or card names) |
| `deckB` | `number | string[]` | no | Main Deck Player B (passcodes or card names) |
| `deck` | `string` | no | Player A deck as ydke:// link, .ydk content/path or a text card list |
| `opponentDeck` | `string` | no | Player B deck as ydke:// link, .ydk content/path or a text card list |
| `handA` | `number | string[]` | no | Hand Player A |
| `handB` | `number | string[]` | no | Hand Player B |
| `extraA` | `number | string[]` | no | Extra Deck Player A |
| `extraB` | `number | string[]` | no | Extra Deck Player B |
| `startingLP` | `number` | no | Starting LP (default `8000`) |
| `maxSteps` | `number` | no | Maximum engine steps (default `120`) |
| `ai` | `"none" | "greedy"` | no | Use the heuristic AI for both sides instead of the passive default responder (default `"none"`) |
| `exploration` | `number` | no | AI randomness (0-1) (default `0.1`) |
| `seed` | `number[]` | no | 4-number seed (default 1,2,3,4) |

## Meta and banlists

Monthly tier data, month-over-month deltas and daily tournament shifts.

### `ygo_sync_meta`

Refresh staples and banlists from live APIs for every supported format.

<sub>Sync live meta data (staples, TCG/OCG banlists, usage metrics) from the YGOPRODeck API.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `forceRefresh` | `boolean` | no | Force re-fetching from remote API even if local cache is fresh |

### `ygo_get_monthly_meta`

Monthly tier list, play rates and staple trends per format.

<sub>USE THIS for any "what is the meta / tier list / share %" question. Live tier list straight from the YugiohMeta API (/api/v1/deck-types/rankings) for TCG and OCG, with share %, total tops, player counts, live staples and freshness evidence. AE/Genesys/Master Duel have no live source. Do not quote a tier list from memory. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `month` | `number` | no | Month to check (1-12; defaults to the current month) (default `11`) |
| `year` | `number` | no | Year to check (defaults to 2026) (default `2026`) |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Format (default `"TCG"`) |
| `forceRefresh` | `boolean` | no | Force a refresh from the tournament source (default `false`) |

### `ygo_compare_monthly_meta`

Diff two months of meta data: rising decks, falling decks, banlist impact.

<sub>Compare meta movement between two months (e.g. 2026-10 vs 2026-11): rising stars, falling decks and banlist impact.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `monthA` | `string` | yes | First month (YYYY-MM, e.g. 2026-10) |
| `monthB` | `string` | yes | Second month (YYYY-MM, e.g. 2026-11) |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Format (default `"TCG"`) |

### `ygo_get_daily_meta`

Daily results, emergency banlist flags and micro-meta shifts.

<sub>Check the meta and banlist day by day (YYYY-MM-DD): emergency banlist notices, errata and tournament news from that day.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | `string` | no | Date to check (YYYY-MM-DD, e.g. 2026-11-03; defaults to today) |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Format (default `"TCG"`) |
| `forceRefresh` | `boolean` | no | Force a refresh from the tournament source (default `false`) |

## Market and news

Three markets, one query — rank the whole pool, measure movement, and explain it with news.

### `ygo_check_prices`

TCGPlayer, Yuyu-tei and TCGCorner prices side by side.

<sub>Multi-market price lookup: TCGPlayer (US TCG), Yuyu-tei (JP OCG) and TCGCorner (AE Asian-English). Yuyu-tei is queried with the resolved Japanese card name; when nothing matches, the quote is a search link with price 0 — never a guessed number. This returns one aggregate per card: for per-rarity or per-language printings use ygo_card_printing_prices.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `cardName` | `string` | yes | Card name in English |
| `passcode` | `number` | no | Card passcode, if known |

### `ygo_market_query`

Rank the whole pool by price, demand or measured movement, then explain why with news and banlist evidence.

<sub>USE THIS for market questions that are NOT about one named card: "which card is the most expensive", "what is rising", "what is hot under $5", "why did this card's price move". It ranks and filters the entire card pool by price, demand and measured movement, then correlates the result with YGOrganization news, banlist status, release windows and the live meta. For "expensive but actually sellable", use sortBy: "liquidity_adjusted" (price × demand on log scales) instead of raw price. Ranking is US-based (TCGPlayer/Cardmarket via YGOPRODeck) because Yuyu-tei and TCGCorner have no bulk price feed; set includeMarkets to attach their live quotes for the top results (explain does it by default). Use ygo_check_prices only for a single card's shop-by-shop quotes. Never answer "most expensive / rising" from memory: call this and quote priceBasis, confidence and the data caveats. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `intent` | `"top_price" | "movers" | "explain" | "search"` | no | top_price = rank by price (most expensive first); movers = measured price change from daily snapshots; explain = why a card's price is where it is (news/banlist/release/meta); search = filter + rank (default `"top_price"`) |
| `query` | `string` | no | Free-text name/archetype/type keyword, e.g. an archetype name |
| `card` | `string` | no | Card name to explain (intent=explain) |
| `archetype` | `string` | no | Archetype filter |
| `type` | `string` | no | Card type filter: Effect Monster, Spell Card, Link Monster, ... |
| `race` | `string` | no | Race filter: Spellcaster, Dragon, Cyberse, ... |
| `attribute` | `string` | no | Attribute filter: LIGHT, DARK, FIRE, ... |
| `levelMin` | `number` | no | Minimum Level/Rank |
| `levelMax` | `number` | no | Maximum Level/Rank |
| `atkMin` | `number` | no | Minimum ATK |
| `atkMax` | `number` | no | Maximum ATK |
| `minPrice` | `number` | no | Minimum USD price |
| `maxPrice` | `number` | no | Maximum USD price |
| `banlist` | `"Forbidden" | "Limited" | "Semi-Limited" | "Unlimited"` | no | TCG banlist status filter |
| `releasedWithinDays` | `number` | no | Only cards released in the last N days (e.g. 90) |
| `minWeeklyViews` | `number` | no | Liquidity floor: keep only cards with at least N weekly views. Use this to drop collector-only cards nobody actually buys (e.g. minWeeklyViews: 1000). |
| `priceBasis` | `"market" | "top_printing" | "floor"` | no | market = typical cheapest copy (default); top_printing = collector printing; floor = cheapest printing (default `"market"`) |
| `sortBy` | `"price_desc" | "price_asc" | "demand" | "liquidity_adjusted" | "release_desc" | "name_asc"` | no | Ranking for intent=search. Defaults to price_desc. |
| `windowDays` | `number` | no | Window for intent=movers (7/30/90) (default `30`) |
| `limit` | `number` | no | Max results (1-50) (default `10`) |
| `includeNews` | `boolean` | no | Attach matching news articles to the answer (default `false`) |
| `includeMarkets` | `boolean` | no | Attach live Yuyu-tei (JPY) and TCGCorner (HKD) quotes. Ranking always uses TCGPlayer/Cardmarket; enrichment covers the top 3 results (explain: the card itself). Defaults to true for intent=explain. |

### `ygo_card_printing_prices`

Per-printing prices by set code, rarity and language — null when no source lists that printing.

<sub>USE THIS for any question about "which printing is cheaper", "how much is the Secret Rare", "KR version price", or comparing rarities of the same card. Returns a per-printing table (set code, set name, rarity, language) where each row has a price ONLY if a source actually lists that printing; otherwise price is null. Covers EN (TCGplayer per-product), JP (Yuyu-tei) and AE (TCGCorner); KR, DE/FR/IT/SP/PT and SC/TC have no public per-printing feed and are returned as price:null with a note. Never infer a price from rarity — call this instead. Do not answer from memory; call this tool first.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `cardName` | `string` | yes | Card name in English |
| `maxSets` | `number` | no | How many EN sets to inspect (1-20); each set costs 2 upstream requests (default `8`) |
| `includeLive` | `boolean` | no | Fetch live JP/AE listings and TCGplayer per-printing prices (default `true`) |

### `ygo_get_news`

Latest reveals and banlist news from the YGOrganization feed.

<sub>Fetch new card reveals, banlist news and tournament coverage from the YGOrganization RSS feed.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `limit` | `number` | no | Number of articles to fetch (default `10`) |

### `ygo_get_card_price_trends`

Price history and spread for a single card.

<sub>Full card detail: stats, text, printings, aggregated multi-market prices (TCGPlayer, Yuyu-tei OCG, Cardmarket AE) and Yugipedia links. Per-printing prices are only present when the source reports set_price; a 0 means 'no price for that printing', not 'free'. For any ranking or 'most expensive / rising' question use ygo_market_query instead.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `cardNameOrId` | `string` | yes | Card name (English) or 8-digit passcode |

### `ygo_get_trending_cards`

What the market is buying right now.

<sub>High-demand meta staples with live prices (TCGPlayer/Yuyu-tei/TCGCorner) and live weekly views (YGOPRODeck). Trends derive from live weekly views; tournament share is an editorial estimate. No hardcoded data.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Format (default `"TCG"`) |
| `limit` | `number` | no | Number of hot cards to return (default `8`) |

## Tournament paperwork

Konami-legal decklists and Neuron-style deck images.

### `ygo_generate_tournament_decklist_pdf`

Fill Konami's official KDE decklist form directly.

<sub>Turn a deck (YDK, YDKE, .ydk file or text list) into an official Konami KDE Deck Registration Sheet PDF with the full category tables. Handles Unicode names (Vietnamese, Japanese, etc.) correctly.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `string` | yes | Raw .ydk text, path to a .ydk file, a ydke:// link, or a line-by-line card list |
| `deckName` | `string` | no | Deck name |
| `duelistName` | `string` | no | Duelist full name (auto-split into first/middle and last) |
| `firstName` | `string` | no | First and middle name(s) exactly as they should appear; overrides the auto-split of duelistName |
| `lastName` | `string` | no | Family/last name exactly as it should appear; overrides the auto-split of duelistName |
| `country` | `string` | no | Country of residency (default: Vietnam) |
| `cardGameId` | `string` | no | Konami Card Game ID / COSSY ID (10 digits) |
| `eventName` | `string` | no | Event name (e.g. YCS, National Championship, Regional) |
| `eventDate` | `string` | no | Event date (YYYY-MM-DD) |
| `format` | `"TCG" | "OCG" | "AE" | "Genesys" | "Master Duel"` | no | Event format (default `"TCG"`) |
| `outputPath` | `string` | no | Optional output path for the PDF |

### `ygo_render_deck_image`

Render the deck as a 10-per-row Konami Neuron PNG.

<sub>USE THIS after building or editing a deck when the user wants to see it. Render the deck (Main, Extra, Side) as a PNG in Konami Neuron / tournament decklist layout: 10 cards per row, Monster -> Spell -> Trap, banned cards flagged. The picture is attached to this tool's result as an image block and the absolute outputPath is returned — present it to the user and, if the host has a file-preview or open-file capability, open that path in a tab. Do not describe the image from memory; the rendered file is the source.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `string` | yes | Raw .ydk text, path to a .ydk file, a ydke:// link, or a line-by-line card list |
| `title` | `string` | no | Deck title shown on the banner |
| `lang` | `"jp" | "en"` | no | Heading language: 'jp' or 'en' (default `"jp"`) |
| `outputPath` | `string` | no | Optional output path for the PNG |

## Custom cards and archetype studio

Temp IDs, generated Lua, grid artwork, spec documents and database exports.

### `ygo_create_custom_card`

Register an unreleased or fan-made card: temp ID, Lua script and SVG mockup.

<sub>Register a newly revealed or fan-made card: assign a temporary ID (990000000+), generate a ProjectIgnis Lua script and render an SVG mockup.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | yes | Card name |
| `type` | `string` | yes | Card type (e.g. Effect Monster, Spell Card, Trap Card, Link Monster) |
| `attribute` | `string` | no | Attribute (LIGHT, DARK, FIRE, ...) |
| `race` | `string` | no | Race (Spellcaster, Dragon, ...) |
| `level` | `number` | no | Level / Rank / Link Rating |
| `atk` | `number` | no | ATK |
| `def` | `number` | no | DEF |
| `desc` | `string` | yes | Card effect text |
| `origin` | `"unreleased_official" | "custom_fanmade"` | no | Card source (default `"unreleased_official"`) |
| `sourceUrl` | `string` | no | Link to the reveal article (YGOrganization...) |

### `ygo_migrate_temp_card`

Move a temp ID to its official passcode across registry, Lua and saved YDK files.

<sub>Replace a temporary ID with the official Konami passcode once it is announced, rewriting the registry, the script and every saved .ydk.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tempId` | `number` | yes | Previous temporary ID (990000000+ range) |
| `officialId` | `number` | yes | Official 8-digit Konami passcode |
| `ydkFilesToUpdate` | `string[]` | no | List of .ydk file paths to update automatically |

### `ygo_generate_batch_art_prompt`

Compose a single grid prompt that covers many card artworks.

<sub>Build one grid image prompt (2x2, 3x3) covering all custom cards, saving tokens and image-model calls.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `cards` | `object[]` | yes | Cards that need artwork |
| `style` | `string` | no | Art style (default: anime Yu-Gi-Oh official card art) |

### `ygo_slice_batch_art`

Slice a grid image into square artworks and embed them into the card SVGs.

<sub>Slice the grid image into individual square artworks and embed each one into its matching SVG card.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `gridImagePath` | `string` | yes | Path to the generated grid image |
| `manifest` | `any` | yes | GridManifest data produced by ygo_generate_batch_art_prompt |
| `outputDir` | `string` | no | Output directory for sliced art |

### `ygo_create_archetype_docx`

Produce a structured archetype specification document.

<sub>Create the Master Specification DOCX (Archetype Design Bible) as a Single Source of Truth, with the six-column spec table (ID, Name/Type, Stats, Text, ...).</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `archetypeName` | `string` | yes | Archetype name (e.g. 'Chronofreeze', 'Phantasmagoria') |
| `setcode` | `string` | yes | Identifying Setcode (e.g. '0x99f', '0x88e') |
| `lore` | `string` | yes | Archetype lore and setting |
| `playstyle` | `string` | yes | Strategy, gameplay mechanics and core combos |
| `targetSimulator` | `"omega" | "edopro" | "generic"` | no | Target simulator (omega: 8-digit ID, max 134M int32; edopro: 8-9 digits) (default `"omega"`) |
| `author` | `string` | no | Designer name |
| `cards` | `object[]` | yes | Cards in the archetype |
| `outputPath` | `string` | no | Optional output path for the .docx file |

### `ygo_read_and_validate_docx`

Read an archetype spec back and validate its structure.

<sub>Parse and validate the Master Specification DOCX: data integrity, duplicate IDs, Omega int32 ID range, Setcode and the str1..str16 choice strings.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `docxPath` | `string` | yes | Path to the .docx file to validate |
| `targetSimulator` | `"omega" | "edopro" | "generic"` | no | Target simulator to validate against |

### `ygo_export_database_and_scripts`

Export the archetype to SQLite plus ocgcore Lua scripts.

<sub>Compile the Master DOCX into a SQLite database (.cdb for EDOPro or Databases/gm.db for YGO Omega) and generate every Lua script c<id>.lua for the chosen profile.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `docxPath` | `string` | yes | Path to the Master .docx file |
| `outputDbPath` | `string` | no | Output database path (.cdb or gm.db) |
| `outputScriptsDir` | `string` | no | Directory for the c<id>.lua script files |
| `simulatorProfile` | `"omega" | "edopro" | "generic"` | no | Target simulator profile |

### `ygo_generate_art_prompts`

Generate per-card art prompts from a spec.

<sub>Extract every artwork description from the Master DOCX into ART_PROMPTS.md, with per-card prompts and Master Grid prompts (2x2, 3x3, 4x4).</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `docxPath` | `string` | yes | Path to the Master .docx file |
| `outputMdPath` | `string` | no | Output path for the prompt markdown file |
| `gridLayout` | `"2x2" | "3x3" | "4x4"` | no | Master Grid prompt matrix (default `"3x3"`) |

### `ygo_slice_art_grid`

Slice an art grid into card-ready image files.

<sub>Detect the grid, remove gutters and slice an AI contact sheet into square <id>.jpg card arts (1024x1024, JPEG quality 95) directly into the game's Arts/ folder.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `imagePath` | `string` | yes | Path to the grid image |
| `docxPath` | `string` | no | Master DOCX path to derive the card ID list automatically |
| `cardIds` | `number[]` | no | Manual card ID array when no docx is supplied |
| `outputArtsDir` | `string` | no | Output directory for sliced art (e.g. YGO Omega 'Arts/' or EDOPro 'pics/') |
| `rows` | `number` | no | Grid rows (default 3) (default `3`) |
| `cols` | `number` | no | Grid columns (default 3) (default `3`) |

### `ygo_build_full_pipeline`

Run spec, scripts, art and export end to end.

<sub>Run the whole archetype pipeline in one call: read DOCX -> validate -> compile SQLite DB -> generate Lua scripts -> export ART_PROMPTS.md -> (optional) slice the grid straight into the game folder.</sub>

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `docxPath` | `string` | yes | Master DOCX path |
| `gameRootDir` | `string` | yes | Simulator root folder (containing Omega's Databases/, Scripts/, Arts/ or EDOPro's expansions/) |
| `simulatorProfile` | `"omega" | "edopro" | "generic"` | no | Target simulator profile (default `"omega"`) |
| `gridImagePath` | `string` | no | Grid image path, if already generated, to slice art into the game folder |
