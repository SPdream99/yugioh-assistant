<div align="center">

# Yu-Gi-Oh! Assistant

**Trọng tài giải đấu, deck builder và chuyên gia thị trường mà mọi AI agent có thể gọi qua MCP.**

[![MCP](https://img.shields.io/badge/Model_Context_Protocol-stdio-blue)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A5_24-339933)](../../package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](../../tsconfig.json)

[English](../../README.md) · [Tiếng Việt](README.md) · [Technical reference](../TECHNICAL.md) · [Credits](../CREDITS.md)

</div>

---

Phần lớn trợ lý thẻ bài chỉ diễn giải text. Server này đọc **script Lua mà engine thật thi hành**, và chạy được nó: `ygo_judge_card` phân tích `c<passcode>.lua` từ
[ProjectIgnis](https://github.com/ProjectIgnis/CardScripts), còn `ygo_judge_scenario`
chạy một duel thật trên `ocgcore-wasm` để chốt kết quả.

Đây là MCP server chuẩn trên stdio (Claude Code, Claude Desktop, Codex, OpenCode,
Cursor, VS Code, Windsurf, Gemini CLI, Cline, Zed) kèm CLI `ygo` cho agent chỉ có shell.

Mọi thứ chạy cục bộ. Network chỉ gọi API public chỉ-đọc, cache tại `data/`; danh sách
nguồn và giấy phép ở [docs/CREDITS.md](../CREDITS.md).

> **Trạng thái: beta (0.9.x), đang phát triển.** Sẽ còn lỗi và bề mặt tool sẽ
> thay đổi. Luôn kiểm tra cập nhật trước khi dùng:
> `npx -y yugioh-assistant-mcp@latest --version`, `ygo doctor`, và
> [trang releases](https://github.com/SPdream99/yugioh-assistant-mcp/releases). Ghim
> `@0.9.4` nếu cần một phiên bản cố định.

> **Được xây dựng với AI.** Mã nguồn, kiểm thử và tài liệu trong repo này được viết
> gần như hoàn toàn bởi AI agent, dưới sự giám sát, review và kiểm thử trực tiếp của
> tác giả. **Câu trả lời của AI không được đảm bảo chính xác.** Hãy coi mọi câu trả
> lời, ruling và giá là thông tin tham khảo cần kiểm chứng, không phải kết luận
> cuối cùng: đối chiếu nguồn được trích dẫn, trang banlist và listing thị trường
> trước khi hành động.

> **Tham khảo dự án tương tự.** Trong quá trình thực hiện, dự án đã tham khảo nhiều
> dự án mã nguồn mở tương tự — MCP server cho Yu-Gi-Oh!, deck builder, công cụ tra
> giá, công cụ ruling và hạ tầng MCP — để so sánh cách tiếp cận và quy ước. Chỉ các
> dependency và nguồn dữ liệu liệt kê trong [docs/CREDITS.md](../CREDITS.md) được
> đưa vào; không sao chép code từ dự án không được liệt kê.

## Cài đặt

Cần Node 24+ (ocgcore-wasm cần JSPI). Python 3 chỉ cần cho PDF, ảnh và DOCX.

Trang package: <https://www.npmjs.com/package/yugioh-assistant-mcp> ·
Mã nguồn: <https://github.com/SPdream99/yugioh-assistant-mcp>.

```bash
# 1. tải dữ liệu một lần: card database, rulebook, judge corpus, mẫu deck-list Konami
npx -y yugioh-assistant-mcp fetch-data

# 2. nối server vào mọi AI client có trên máy
npx -y yugioh-assistant-mcp setup
```

Từ source:

```bash
git clone <your-fork-url> yugioh-assistant-mcp
cd yugioh-assistant-mcp
npm install && npm run build
node dist/cli/index.js setup
```

`setup` ghi một entry cho mỗi client và backup mọi file đã sửa
(`.ygo-<timestamp>.bak`). Có thể xem trước hoặc chọn client:

```bash
ygo install --client claude-code,cursor --dry-run
ygo status
ygo uninstall
```

## Bạn có thể hỏi gì

| Nhóm | Ví dụ |
| --- | --- |
| Ruling | *"Card A chain vào Card B — kết quả?"* |
| Rulebook | *"Trích luật Damage Step kèm số trang."* |
| Build deck | *"List hợp lệ cho một archetype, OCG, 60 lá."* |
| Phân tích deck | *"Deck này ra board thật bao nhiêu %?"* |
| Cộng đồng | *"Cho xem deck của một archetype kèm link; gì counter deck khác?"* |
| Thị trường | *"Lá đắt nhất mà vẫn có người tìm mua."* |
| Giá theo bản in | *"Secret có rẻ hơn Ultra không? Bản KR thì sao?"* |
| Giấy tờ | *"Chuyển .ydk thành decklist KDE in được."* |

## Công cụ

Tên tool và mô tả ngắn giữ nguyên tiếng Anh để khớp chính xác schema MCP mà model nhìn thấy.

<!-- tools:start -->
**Deck analysis**

| Tool | Chức năng |
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

**Card database**

| Tool | Chức năng |
| --- | --- |
| `ygo_get_card` | Look a card up by name or passcode, with Yugipedia cross-references. |
| `ygo_card_dossier` | One call for everything about a card: database, wiki, script provenance, rulings. |
| `ygo_search_cards` | Filter the card pool by ATK, DEF, type, race, attribute, level or archetype. |

**Rulings and simulation**

| Tool | Chức năng |
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

**Meta and banlists**

| Tool | Chức năng |
| --- | --- |
| `ygo_sync_meta` | Refresh staples and banlists from live APIs for every supported format. |
| `ygo_get_monthly_meta` | Monthly tier list, play rates and staple trends per format. |
| `ygo_compare_monthly_meta` | Diff two months of meta data: rising decks, falling decks, banlist impact. |
| `ygo_get_daily_meta` | Daily results, emergency banlist flags and micro-meta shifts. |

**Prices and news**

| Tool | Chức năng |
| --- | --- |
| `ygo_check_prices` | TCGPlayer, Yuyu-tei and TCGCorner prices side by side. |
| `ygo_market_query` | Rank the whole pool by price, demand or measured movement, then explain why with news and banlist evidence. |
| `ygo_card_printing_prices` | Per-printing prices by set code, rarity and language — null when no source lists that printing. |
| `ygo_get_news` | Latest reveals and banlist news from the YGOrganization feed. |
| `ygo_get_card_price_trends` | Price history and spread for a single card. |
| `ygo_get_trending_cards` | What the market is buying right now. |

**Tournament paperwork**

| Tool | Chức năng |
| --- | --- |
| `ygo_generate_tournament_decklist_pdf` | Fill Konami's official KDE decklist form directly. |
| `ygo_render_deck_image` | Render the deck as a 10-per-row Konami Neuron PNG. |

**Custom cards and archetype studio**

| Tool | Chức năng |
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

Tham chiếu đầy đủ tham số: [TOOLS.md](../TOOLS.md).

## Nguồn dữ liệu

| Nguồn | Dùng cho | Phạm vi |
| --- | --- | --- |
| YGOPRODeck | thẻ, printing, banlist, deck, staple | toàn cầu |
| TCGCSV / TCGplayer | giá EN theo từng printing | EN |
| Yuyu-tei | listing JP OCG | JP |
| TCGCorner | listing AE | AE |
| Cardmarket (qua YGOPRODeck) | benchmark EUR | EU |
| Master Duel Meta | deck, combo, counter Master Duel | MD |
| Konami Card Database | deck recipe chính thức, card page | official |
| Format Library | deck GOAT / Edison / Fiber | retro |
| Yugipedia | tên 12 ngôn ngữ, ruling, tips, trivia | CC BY-SA 3.0 |
| YGOrganization | tin tiết lộ, banlist | news |
| YugiohMeta / YGO Omega | tier TCG/OCG và Genesys | meta |
| ProjectIgnis | script Lua + engine ocgcore | engine |

**Phạm vi ngôn ngữ được nêu rõ.** EN, JP, AE có feed giá trực tiếp. KR, DE/FR/IT/SP/PT,
SC/TC không có — công cụ trả `price: null` kèm ghi chú, không thay bằng giá US và
không suy từ độ hiếm.

## Độ tin cậy

- **Mọi request đi qua một HTTP client**: hàng đợi theo host, giãn cách 250 ms cho
  TCGCSV, retry backoff khi 429/5xx, tôn trọng `Retry-After`.
- **Offline**: `ygo call <tool> --offline` hoặc `YGO_OFFLINE=1` fail ngay với lý do
  rõ ràng; tool trả `available: false` thay vì treo.
- **Freshness evidence**: timestamp, điểm 0–100, badge và SHA-256 trên payload.
- **Không telemetry, không tài khoản, không server.** Dữ liệu deck không rời máy.
- **Path guard**: tool ghi file từ chối ghi ngoài project hoặc thư mục simulator.

## CLI

| Lệnh | Mục đích |
| --- | --- |
| `ygo install` / `setup` / `status` / `uninstall` | nối server vào AI client |
| `ygo serve` | MCP qua stdio (hỗ trợ `--offline`) |
| `ygo tools` / `ygo call <tool>` | xem và gọi tool không cần MCP |
| `ygo doctor` | runtime, build, dữ liệu, client (`--sources`, `--fix`) |
| `ygo cache` | dung lượng/độ tuổi cache; `--clear market --yes` |
| `ygo fetch-data` | tải cards.cdb, rulebook, judge corpus, mẫu deck-list Konami |
| `ygo docs` | sinh lại bảng tool (`--check` trong CI) |
| `ygo stats` / `ygo clean` | báo cáo dữ liệu / dọn artifact cũ |

## Kiến trúc

```
src/tools/index.ts        lớp MCP — mỗi tool một entry, schema zod = tài liệu
src/core/                 engine
  card-scripts/           Lua AST, judge, ocgcore runtime, scenario
  card-database/          card pool, dossier, search, combo
  deck-parser/            ydk/ydke, legality
  meta-deck-builder/      template, live meta, matchup, staple
  pricing/                index, history, printing prices, market
  deck-community/         YGOPRODeck / MDM / Konami / Format Library
  news-rulings/           rulebook, policy corpus, YGOrganization, citation
  custom-cards/           registry, Lua generator, renderer
  deck-export/            PDF KDE + PNG kiểu Neuron (Python)
src/cli/                  installer, shell, docs generator
skills/                   SKILL.md cho agent
```

Chi tiết kỹ thuật (data flow, thuật toán, giới hạn): **[docs/TECHNICAL.md](../TECHNICAL.md)**.

## Phát triển

```bash
npm run build          # tsc → dist/
npm test               # e2e (cần mạng)
npm run test:http      # retry/backoff/rate-limit (offline)
npm run test:fixtures  # parser với response tổng hợp (offline)
npm run test:compare   # unit test so sánh deck
npm run test:pack      # pack → cài temp → MCP handshake
npm run docs           # sinh lại bảng tool
npm run doctor         # kiểm tra môi trường
```

Thêm tool: thêm entry vào `TOOLS` trong [`src/tools/index.ts`](../../src/tools/index.ts),
xếp vào nhóm trong [`src/cli/tooling.ts`](../../src/cli/tooling.ts), rồi
`npm run build && npm run docs`.

## Giấy phép & tri ân

**Mã nguồn: [AGPL-3.0-only](../../LICENSE).** Bạn được dùng, sửa và phân phối lại
theo AGPL; bản sửa đổi khi phân phối hoặc cung cấp qua mạng phải giữ nguyên giấy
phép. Giấy phép cho phép bên thứ ba sử dụng thương mại — dự án này tự vận hành phi
thương mại và không liên kết với Konami Digital Entertainment, Shueisha, TV Tokyo
hay Studio Dice. Yu-Gi-Oh! và mọi nhãn hiệu liên quan thuộc về chủ sở hữu tương ứng.

**Sẵn sàng gỡ bỏ:** nếu chủ sở hữu quyền yêu cầu, repo và package npm sẽ được gỡ
ngay, không cần thủ tục pháp lý. Xem [NOTICE](../../NOTICE).

Mẫu deck-list của Konami (`data/templates/KDE_DeckList.pdf`) **không đi kèm package**;
`ygo fetch-data` tải từ Konami khi cần, hoặc trỏ `YGO_KDE_TEMPLATE` tới bản của bạn.
Điều khoản đầy đủ: [docs/LEGAL.md](../LEGAL.md) ([bản dịch tiếng Việt](LEGAL.md)).
Nguồn dữ liệu và thư viện: [docs/CREDITS.md](../CREDITS.md)
([tiếng Việt](CREDITS.md)).
