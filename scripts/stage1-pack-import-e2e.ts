// Runs the real agent import over the shipped DeepSeek Bots pack on a temporary profile: the archive
// reader, the manifest decoder, the imported-files writer, and the channel creation, through the same
// `AgentService`, `LocalSkillLibrary`, and `AgentImportService` that the app builds.
// Cases: the preview names 12 agents and 3 channels, `source.app` is `deepseek-bots`, and there is no
// warning; the import creates all 15 and skips nothing; every channel member is an imported agent and
// its lead is the agent the manifest names; each agent's workspace holds `imported/INSTRUCTIONS.md`
// byte-identical to the pack file, and that text carries the citation contract: a `[title](url)` link,
// the date it was opened, `not found`, and `blocked: `. A live model answer is not part of this check:
// it needs a provider and spends tokens, so the dated-URL requirement is proved on the bytes the agent
// reads, not on a turn. Negative control: the same pack plus a `.env` entry is refused with the named
// unsafe-file error. `bun run test:stage1-pack-import`. Writes .openbot-build/stage1/pack-import.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentImportSkipped } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { zipSync } from "fflate";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/stage1");
const PACK = resolve(import.meta.dirname, "../resources/agent-import/deepseek-bots");
const PACK_KEYS = [
  "brief-writer",
  "code-reviewer",
  "competitor-watchtower",
  "content-studio",
  "deck-builder",
  "inbox-triage",
  "invoice-clerk",
  "long-doc-analyst",
  "meeting-to-actions",
  "ops-sentinel",
  "research-desk",
  "support-drafter",
];
/** The lead of each channel in the pack. A channel member is always an agent key of this manifest. */
const CHANNEL_LEADS: readonly (readonly [string, string])[] = [
  ["research-desk", "research-desk"],
  ["launch-room", "content-studio"],
  ["support-triage", "inbox-triage"],
];
/** The contract that every template in this pack carries, and the marker that proves it. */
const CONTRACT: readonly (readonly [string, RegExp])[] = [
  ["citation link", /\[title\]\(url\)/u],
  ["retrieval date", /\bdate\b|retriev/iu],
  ["not found", /not found/u],
  ["blocked", /blocked: /u],
  ["deletion test", /delet/iu],
];
const HOSTILE_ENTRY = "agents/research-desk/files/.env.local";

const root = await mkdtemp(join(tmpdir(), "openbot-stage1-import-"));
const userData = join(root, "user-data");
const home = join(root, "home");
mkdirSync(home, { recursive: true });
// The stores read the home folder, so it must name the temporary profile before the modules load.
process.env.HOME = home;
process.env.USERPROFILE = home;

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { AgentImportService } = await import("../src/main/agent-import-service");
const { LocalSkillLibrary } = await import("../src/main/local-skill-library");

interface InstructionEvidence {
  bytes: number;
  identical: boolean;
  contract: Record<string, boolean>;
}

const report: {
  passed: boolean;
  sourceApp?: string;
  exportedAt?: string | null;
  preview?: {
    agents: number;
    channels: number;
    routines: number;
    memories: number;
    instructionsBytes: number;
    warnings: string[];
  };
  imported?: {
    agents: string[];
    channels: string[];
    skipped: AgentImportSkipped[];
    skippedChannels: AgentImportSkipped[];
    warnings: string[];
  };
  leaders?: Record<string, string>;
  instructions?: Record<string, InstructionEvidence>;
  hostile?: { entry: string; refused: string; matchesNamedError: boolean };
  answerEvidence?: string;
  failure?: string;
} = { passed: false };

/** Every file of the pack, keyed by its archive path, with `openbot-import.json` at the root. */
function packFiles(directory = PACK, prefix = ""): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, packFiles(join(directory, entry.name), name));
    else files[name] = new Uint8Array(readFileSync(join(directory, entry.name)));
  }
  return files;
}

/** Writes an archive in the temporary profile and answers its path. */
async function archive(name: string, files: Record<string, Uint8Array>): Promise<string> {
  const path = join(root, name);
  await writeFile(path, zipSync(files, { level: 6 }));
  return path;
}

/** The refusal of a stage or an apply, as the text the person reads. */
async function refusal<T>(operation: Promise<T>): Promise<string> {
  const outcome = await operation.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(outcome !== null, "The import must refuse the archive.");
  return outcome;
}

const unused = () => Effect.die(new Error("Not used: the pack has no skill folder."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

let database: InstanceType<typeof OpenBotDatabase> | null = null;
let agents: InstanceType<typeof AgentService> | null = null;
try {
  const clean = await archive("deepseek-bots.zip", packFiles());
  const hostile = await archive("hostile.zip", {
    ...packFiles(),
    [HOSTILE_ENTRY]: new TextEncoder().encode("DEEPSEEK_KEY=not-a-real-key\n"),
  });

  database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "deepseek",
    // No provider is off, so a profile is created without a provider check. This check runs no turn,
    // and the pack sets no model: the agent keeps the starting choice of the host.
    offProviders: [],
    timezone: () => "UTC",
  });
  agents = service;
  const library = new LocalSkillLibrary(join(root, "local-skills"), () => service.listAgents());
  const imports = new AgentImportService(
    service,
    { library: () => library, installLocal: unused },
    () => ({ id: "local", name: "Local user" }),
    () => "UTC",
  );
  await runCauseEffect(service.initialize());

  // The negative control runs first, so a refused archive is proved before the good one is applied.
  const refused = await refusal(runCauseEffect(imports.stage(hostile)));
  const named = sourceText("error.import.unsafeFile", { name: HOSTILE_ENTRY });
  report.hostile = { entry: HOSTILE_ENTRY, refused, matchesNamedError: refused === named };
  assert.equal(refused, named, "A .env entry must be refused as an unsafe file.");

  const preview = await runCauseEffect(imports.stage(clean));
  report.sourceApp = preview.sourceApp;
  report.exportedAt = preview.exportedAt;
  report.preview = {
    agents: preview.agents.length,
    channels: preview.channels.length,
    routines: preview.agents.reduce((total, agent) => total + agent.routineCount, 0),
    memories: preview.agents.reduce((total, agent) => total + agent.memoryCount, 0),
    instructionsBytes: preview.agents.reduce((total, agent) => total + agent.fileBytes, 0),
    warnings: preview.warnings,
  };
  assert.equal(preview.sourceApp, "deepseek-bots", "The import must name the source app of the pack.");
  assert.equal(preview.exportedAt, "2026-11-01T00:00:00Z", "The export date must survive the decode.");
  assert.equal(preview.agents.length, PACK_KEYS.length, "The preview must list 12 agents.");
  assert.equal(preview.channels.length, 3, "The preview must list 3 channels.");
  assert.deepEqual(preview.warnings, [], "The shipped pack must preview with no warning.");
  assert.deepEqual(
    preview.agents.map((agent) => agent.key).sort(),
    PACK_KEYS,
    "The preview must name the 12 pack agents.",
  );
  for (const agent of preview.agents) {
    assert.equal(agent.skillCount, 0, `${agent.key}: the pack ships no skill folder.`);
    assert.ok(agent.routineCount >= 1, `${agent.key}: the agent has no routine.`);
    assert.ok(agent.memoryCount >= 1, `${agent.key}: the agent has no memory.`);
    assert.ok(agent.fileBytes > 0, `${agent.key}: the agent has no workspace file.`);
    assert.equal(agent.nameExists, false, `${agent.key}: the profile is new.`);
    assert.ok(
      agent.description.includes("imported/INSTRUCTIONS.md"),
      `${agent.key}: the description must name imported/INSTRUCTIONS.md.`,
    );
  }

  const result = await runCauseEffect(
    imports.apply({
      token: preview.token,
      keys: preview.agents.map((agent) => agent.key),
      channelKeys: preview.channels.map((channel) => channel.key),
    }),
  );
  report.imported = {
    agents: result.agents.map((agent) => agent.name).sort(),
    channels: result.channels.map((channel) => channel.name).sort(),
    skipped: result.skipped,
    skippedChannels: result.skippedChannels,
    warnings: result.warnings,
  };
  assert.deepEqual(result.skipped, [], "No agent may be skipped.");
  assert.deepEqual(result.skippedChannels, [], "No channel may be skipped.");
  assert.deepEqual(result.warnings, [], "The shipped pack must import with no warning.");
  assert.equal(result.agents.length, PACK_KEYS.length, "The import must create 12 agents.");
  assert.equal(result.channels.length, 3, "The import must create 3 channels.");

  // Each agent's files are the pack bytes, not a copy that the import rewrote.
  const keyByName = new Map(preview.agents.map((agent) => [agent.name, agent.key]));
  const agentIdByKey = new Map<string, string>();
  const instructions: Record<string, InstructionEvidence> = {};
  report.instructions = instructions;
  for (const agent of result.agents) {
    const key = keyByName.get(agent.name);
    assert.ok(key, `${agent.name}: the imported agent must match a preview agent.`);
    agentIdByKey.set(key, agent.id);
    const written = readFileSync(join(agent.workspacePath, "imported", "INSTRUCTIONS.md"));
    const shipped = readFileSync(join(PACK, "agents", key, "files", "INSTRUCTIONS.md"));
    const body = written.toString("utf8");
    const contract: Record<string, boolean> = {};
    for (const [name, pattern] of CONTRACT) contract[name] = pattern.test(body);
    instructions[key] = { bytes: written.byteLength, identical: written.equals(shipped), contract };
    assert.ok(written.equals(shipped), `${key}: imported/INSTRUCTIONS.md must be the pack file byte for byte.`);
    for (const [name, present] of Object.entries(contract))
      assert.ok(present, `${key}: the instructions must keep the ${name} rule.`);
  }

  // Every member is an agent this import created, and the lead is the one the manifest names.
  const leaders: Record<string, string> = {};
  report.leaders = leaders;
  for (const created of result.channels) {
    const source = preview.channels.find((channel) => channel.name === created.name);
    assert.ok(source, `${created.name}: the imported channel must match a preview channel.`);
    const channel = service.channels.store.get(created.id);
    const expected = source.memberKeys.map((key) => {
      const id = agentIdByKey.get(key);
      assert.ok(id, `${created.name}: the member ${key} must be an imported agent.`);
      return id;
    });
    assert.deepEqual(
      channel.members.map((member) => member.agentId).sort(),
      expected.sort(),
      `${created.name}: the channel must hold its imported members.`,
    );
    const pair = CHANNEL_LEADS.find(([key]) => key === source.key);
    assert.ok(pair, `${source.key}: this check must know the lead of the channel.`);
    const [, leadKey] = pair;
    assert.equal(source.leadKey, leadKey, `${source.key}: the manifest must lead with ${leadKey}.`);
    const leadId = agentIdByKey.get(leadKey);
    assert.ok(leadId, `${source.key}: the lead ${leadKey} must be an imported agent.`);
    assert.equal(channel.leadAgentId, leadId, `${source.key}: the lead must be its agent.`);
    leaders[source.key] = leadKey;
  }

  // The dated-URL answer is proved on the bytes the agent reads, because a live turn needs a provider
  // and spends tokens. A template that lost the rule fails above, on the contract check.
  report.answerEvidence =
    "the INSTRUCTIONS.md bytes carry the [title](url) rule, the date it was opened, `not found`, and " +
    "`blocked: `; a live model answer is not run by this check.";
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  if (agents) await runCauseEffect(agents.stop()).catch(() => {});
  if (database) database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "pack-import.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // A SQLite handle can stay open on Windows after stop; a leftover temp folder is harmless, and
  // the report above is the artifact this gate is judged by.
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}
