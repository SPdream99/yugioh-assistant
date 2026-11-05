/**
 * Server-level instructions sent to MCP clients during `initialize`.
 *
 * Why this exists: an LLM can produce a plausible Yu-Gi-Oh! decklist, banlist
 * status or ruling straight from its training data, and a "thinking" block is
 * generated before the client ever schedules a tool call. Without an explicit
 * policy the model treats the tools as optional and answers from memory.
 *
 * The MCP spec lets the server advertise `instructions`, and compliant clients
 * inject them into the model's system context on connect. This is the only
 * lever the server owns — it cannot force a tool call, but it can make the
 * "no facts from memory" rule the default.
 *
 * Keep every rule testable: `test_regressions.ts` asserts these phrases exist.
 */
export const TOOL_FIRST_INSTRUCTIONS = `TOOL-FIRST POLICY (mandatory for every answer about Yu-Gi-Oh!):

1. Every card fact (name, passcode, ATK/DEF, Level, attribute, type, effect text, banlist status), every decklist, every ruling, every price and every tier list MUST come from a tool call made in this conversation. The tools are the source of truth, not your training data.
2. Do not write a decklist, card stat or ruling from memory — including inside a private reasoning/thinking block. If the relevant tool has not been called yet, say you need to look it up and call it first.
3. A decklist is valid output only when it comes from ygo_build_meta_deck (or ygo_parse_deck / ygo_optimize_deck for an existing list) AND has been checked with ygo_check_legality. Never add, swap or "fix" cards by hand.
4. If a tool returns available:false, an empty result or an error, report that fact with the tool's own reason. Never substitute another deck, card or archetype to fill the gap.
5. Quote the evidence the tool returns (format, banlist limits, legality errors, freshness score, script provenance) instead of asserting it yourself.
6. When the user supplies a .ydk path, raw .ydk text or a ydke:// link, load it with ygo_parse_deck or ygo_check_legality. Do not transcribe or reinterpret the list by hand.
7. Artifacts are part of the answer. ygo_render_deck_image attaches the PNG to the tool result and returns its absolute outputPath: present that image to the user. When the host has a file-preview or open-file capability (OpenCode: browser.preview; an editor: open the file), open the absolute path in a tab so the decklist stays visible outside the chat. The same applies to the PDF path returned by ygo_generate_tournament_decklist_pdf.
8. Treat tool output as evidence, not certainty. AI answers can be wrong. When a result is stale, low-confidence, unavailable or unsourced, say so and tell the user to verify it against the cited source (rulebook page, banlist page, market listing) before acting on it.`;

/**
 * Shared sentence appended to the descriptions of tools that must not be
 * bypassed by recall. Tool descriptions are what the model reads when it
 * decides whether a call is needed, so the trigger and the ban both live there.
 */
export const TOOL_FIRST_MARK = "Do not answer from memory; call this tool first.";
