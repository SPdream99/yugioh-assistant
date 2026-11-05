import { installSkill, skillTargetPath } from "./skill.js";
import {
  CLIENTS,
  applyClient,
  findClient,
  isDetected,
  removeClient,
  resolveConfigPath,
  verifyAnyScope,
  type ApplyResult,
  type ClientDefinition
} from "../clients.js";
import { buildEntry, describeEntry, hasBuild, resolveMode, type InstallMode, type McpEntry } from "../entry.js";
import { heading, hr, log, printTable, style } from "../ui.js";

export interface InstallOptions {
  clients?: string[];
  scope: "user" | "project";
  mode: InstallMode;
  dryRun: boolean;
  json: boolean;
  withSkill: boolean;
}

function selectClients(requested: string[] | undefined): { clients: ClientDefinition[]; unknown: string[] } {
  if (!requested || requested.length === 0) {
    return { clients: CLIENTS.filter(isDetected), unknown: [] };
  }
  if (requested.includes("all")) return { clients: CLIENTS, unknown: [] };
  if (requested.includes("detected")) {
    return { clients: CLIENTS.filter(isDetected), unknown: [] };
  }

  const clients: ClientDefinition[] = [];
  const unknown: string[] = [];
  for (const id of requested) {
    const client = findClient(id);
    if (client) clients.push(client);
    else unknown.push(id);
  }
  return { clients, unknown };
}

function statusCell(result: ApplyResult, dryRun: boolean): string {
  switch (result.status) {
    case "configured":
      return style.ok(dryRun ? "would configure" : "configured");
    case "unchanged":
      return style.muted("already configured");
    case "removed":
      return style.ok(dryRun ? "would remove" : "removed");
    case "not-configured":
      return style.muted("not configured");
    case "unsupported":
      return style.muted("not supported");
    default:
      return style.err("failed");
  }
}

export async function runInstall(options: InstallOptions): Promise<number> {
  const { clients, unknown } = selectClients(options.clients);
  if (unknown.length > 0) {
    log.fail(`Unknown client: ${unknown.join(", ")}`);
    log.muted(`Available: ${CLIENTS.map((client) => client.id).join(", ")}`);
    return 2;
  }
  if (clients.length === 0) {
    log.warn("No supported AI client was detected on this machine.");
    log.muted("Pick one explicitly: ygo install --client claude-code");
    log.muted(`Supported: ${CLIENTS.map((client) => client.id).join(", ")}`);
    return 1;
  }

  const resolved = resolveMode(options.mode);
  const entry = buildEntry(resolved.mode);

  if (resolved.mode === "local" && !hasBuild()) {
    log.fail("dist/index.js is missing — build the project first:");
    log.muted("npm install && npm run build");
    return 1;
  }

  if (!options.json) {
    heading(
      options.dryRun ? "Install preview" : "Installing Yu-Gi-Oh! Assistant",
      `${resolved.mode === "local" ? "Local build" : "Published package"} · ${resolved.reason}`
    );
    log.muted(`launch: ${describeEntry(entry)}`);
    if (options.scope === "project") log.muted("scope: project (writes into the current directory)");
    log.blank();
  }

  const results: ApplyResult[] = [];
  for (const client of clients) {
    const result = applyClient(client, entry, {
      scope: options.scope,
      dryRun: options.dryRun
    });
    results.push(result);
  }

  let skillResult: { status: string; path: string } | undefined;
  const targetsClaudeCode = clients.some((client) => client.id === "claude-code");
  if (options.withSkill && targetsClaudeCode) {
    skillResult = installSkill({ dryRun: options.dryRun });
  }

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          mode: resolved.mode,
          entry,
          scope: options.scope,
          dryRun: options.dryRun,
          results: results.map((result) => ({
            client: result.client.id,
            status: result.status,
            configPath: result.configPath,
            backupPath: result.backupPath,
            message: result.message
          })),
          skill: skillResult
        },
        null,
        2
      ) + "\n"
    );
    return results.some((result) => result.status === "failed") ? 1 : 0;
  }

  printTable(
    ["Client", "Status", "Configuration"],
    results.map((result) => [
      result.client.label,
      statusCell(result, options.dryRun),
      result.configPath || style.muted("—")
    ])
  );

  for (const result of results) {
    if (result.message) log.muted(`${result.client.label}: ${result.message}`);
    if (result.backupPath) log.muted(`backup: ${result.backupPath}`);
  }

  if (skillResult) {
    log.blank();
    const verb =
      skillResult.status === "unchanged"
        ? "Skill already up to date"
        : options.dryRun
          ? "Skill would be written"
          : "Skill installed";
    log.ok(`${verb} → ${style.muted(skillResult.path)}`);
  }

  const configured = results.filter((result) => result.status === "configured").length;
  const failed = results.filter((result) => result.status === "failed");

  log.blank();
  if (failed.length > 0) {
    log.fail(`${failed.length} client(s) could not be configured.`);
  } else if (configured === 0) {
    log.info("Nothing changed — every selected client was already configured.");
  } else {
    log.ok(
      options.dryRun
        ? `Dry run complete — ${configured} client(s) would be updated.`
        : `Ready. Restart ${configured === 1 ? "the client" : "your clients"} to load the server.`
    );
  }

  if (!options.dryRun && configured > 0) {
    log.blank();
    log.muted("Verify with:  ygo doctor");
    log.muted("Or call a tool directly:  ygo call ygo_get_card --name \"Dark Magician\"");
  }

  return failed.length > 0 ? 1 : 0;
}

export async function runUninstall(options: InstallOptions): Promise<number> {
  const { clients, unknown } = selectClients(options.clients);
  if (unknown.length > 0) {
    log.fail(`Unknown client: ${unknown.join(", ")}`);
    return 2;
  }

  const results = clients.map((client) =>
    removeClient(client, { scope: options.scope, dryRun: options.dryRun })
  );

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        results.map((result) => ({
          client: result.client.id,
          status: result.status,
          configPath: result.configPath
        })),
        null,
        2
      ) + "\n"
    );
  } else {
    heading("Removing Yu-Gi-Oh! Assistant");
    printTable(
      ["Client", "Status", "Configuration"],
      results.map((result) => [result.client.label, statusCell(result, options.dryRun), result.configPath || "—"])
    );
  }

  return results.some((result) => result.status === "failed") ? 1 : 0;
}

export async function runStatus(json: boolean): Promise<number> {
  const entry = buildEntry(resolveMode("auto").mode);
  const rows = CLIENTS.map((client) => {
    const detected = isDetected(client);
    const configPath = resolveConfigPath(client, "user") ?? resolveConfigPath(client, "project");
    const verification = verifyAnyScope(client, entry);
    return {
      id: client.id,
      label: client.label,
      detected,
      configured: verification.configured,
      scope: verification.scope ?? null,
      configPath: verification.configPath ?? configPath ?? null
    };
  });

  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }

  heading("Client status");
  printTable(
    ["Client", "Detected", "Configured", "Configuration"],
    rows.map((row) => [
      row.label,
      row.detected ? style.ok("yes") : style.muted("no"),
      row.configured
        ? style.ok(`yes${row.scope ? ` (${row.scope})` : ""}`)
        : style.muted("no"),
      row.configPath ?? style.muted("—")
    ])
  );
  log.blank();
  log.muted(`Skill target: ${skillTargetPath()}`);
  log.muted("Configure a client with:  ygo install --client <id>");
  return 0;
}
