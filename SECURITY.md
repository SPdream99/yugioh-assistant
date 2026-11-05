# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.9.x | yes |
| < 0.9 | no (never published) |

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting:
`Security` tab → `Report a vulnerability`
(<https://github.com/SPdream99/yugioh-assistant-mcp/security/advisories/new>).

Include:

- affected version (`ygo --version`) and platform;
- the tool or CLI command involved;
- a minimal reproduction (input, expected, actual);
- impact: data disclosure, path escape, code execution, denial of service.

You can expect an acknowledgement within **72 hours** and a status update within
**7 days**. Please give a reasonable window before public disclosure.

## Scope

In scope:

- the MCP server (`dist/index.js`) and CLI (`ygo`);
- file-writing tools and the output-path guard;
- parsers for third-party responses (Lua, HTML, JSON, PDF text);
- install/uninstall logic that edits AI-client configuration files.

Out of scope:

- the correctness of third-party APIs (YGOPRODeck, TCGCSV, Konami, Master Duel
  Meta, Yuyu-tei, TCGCorner, Format Library, Yugipedia, YGOrganization);
- disputes about Yu-Gi-Oh! rules — those belong to the head judge;
- price accuracy or trading decisions;
- vulnerabilities in AI clients that host the MCP server.

## Data handling

- No telemetry, no accounts, no remote storage.
- Deck lists, custom cards and caches stay on disk under the data root
  (`~/.yugioh-assistant-mcp` for npm installs, the project directory for a checkout).
- The only secrets involved are your AI-client configuration files and an npm
  token if you publish; neither is read by the server.
- Outbound traffic is limited to the public read-only APIs listed in
  [CREDITS.md](docs/CREDITS.md).

## Hardening already in place

- every outbound call goes through one HTTP client with rate limiting, retries
  and timeouts;
- `YGO_OFFLINE=1` refuses network access before a socket is opened;
- **SSRF guard**: caller-supplied URLs (`ygo_ensure_script --from-news`) must be
  public http(s); loopback, private ranges, link-local metadata and non-http
  schemes are refused after DNS resolution too, and article bodies are capped at
  5 MB;
- **no shell execution**: Python helpers are invoked with `execFile`, so a deck
  title or path can never become a shell command;
- **file-writing tools are path-guarded** (deck PNG, PDF, DOCX, art slicing,
  script migration): writes stay inside the project or a recognised simulator
  install, and game-root matching requires a real path segment;
- **read caps**: deck lists and CLI JSON inputs are limited to 2 MB / 1 MB and
  binary files are rejected; MCP tool arguments above 1 MB are refused before
  validation;
- generated Lua scripts are labelled and never override official or manual ones;
- dependencies are pinned in `package-lock.json`; `npm audit --omit=dev` is
  clean (zod 4.6.7 or newer, fixing GHSA-mrhx-c7xc-m3w5).
