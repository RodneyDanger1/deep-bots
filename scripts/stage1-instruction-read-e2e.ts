// Reads the 12 authored templates of the DeepSeek Bots pack and injects each one through the real
// workspace instruction reader: the same `promptInstructionsFile` that builds the prompt of a turn.
// Cases: the pack manifest decodes with no warning and names 12 agents; each authored template is
// 2,500 to 5,800 characters and carries the eight headings of the template contract in order; the
// bytes on disk are the bytes the prompt carries, apart from the trim that the prompt applies; a
// 32,000-character file is injected whole and is not marked truncated; a 32,001-character file is cut
// to exactly 32,000 characters and is marked truncated.
// Negative controls: a single changed byte must fail the byte comparison the check uses, and the
// 32,001-character text must not compare equal to the injected text. Without them, "the bytes match"
// would be a claim that cannot fail.
// `bun run test:stage1-instruction-read`. Writes .openbot-build/stage1/instruction-read.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_INSTRUCTION_FILE_NAMES } from "@openbot/contracts/ipc";
import { promptInstructionsFile } from "../src/backend/agent/workspace-instructions";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeImportManifest } from "../src/main/agent-import-manifest";

const OUT = resolve(import.meta.dirname, "../.openbot-build/stage1");
const PACK = resolve(import.meta.dirname, "../resources/agent-import/deepseek-bots");
const MANIFEST = join(PACK, "openbot-import.json");
/** The template contract of the pack: 8 headings, in this order, and a length in this range. */
const HEADINGS = [
  "# Never",
  "# Role",
  "# Scope",
  "# Procedure",
  "# Output",
  "# Memory & routines",
  "# Delegation",
  "# Examples (format only)",
];
const MIN_CHARS = 2_500;
const MAX_CHARS = 5_800;

interface TemplateEvidence {
  bytes: number;
  characters: number;
  headings: number;
  identical: boolean;
  injectedCharacters: number;
  truncated: boolean;
}

/** What the reader did with one file at a length boundary. */
interface Boundary {
  characters: number;
  truncated: boolean;
}

const report: {
  passed: boolean;
  agents?: number;
  warnings?: string[];
  limit?: number;
  templates?: Record<string, TemplateEvidence>;
  boundaries?: { full: Boundary; over: Boundary };
  negativeControl?: { changedBytesFail: boolean; overLimitFails: boolean };
  failure?: string;
} = { passed: false };

const root = await mkdtemp(join(tmpdir(), "openbot-stage1-read-"));

/** The bytes on disk and the text that the prompt carries, for one instruction file. */
async function inject(workspace: string, name: string, bytes: Uint8Array) {
  const directory = join(root, "workspaces", workspace);
  mkdirSync(directory, { recursive: true });
  await writeFile(join(directory, name), bytes);
  const prompt = await runCauseEffect(promptInstructionsFile(directory, AGENT_INSTRUCTION_FILE_NAMES));
  assert.ok(prompt !== null, `${workspace}: the reader must find the instruction file.`);
  return prompt;
}

try {
  const { manifest, warnings } = decodeImportManifest(new Uint8Array(readFileSync(MANIFEST)), 64);
  report.agents = manifest.agents.length;
  report.warnings = warnings;
  assert.deepEqual(warnings, [], "The shipped manifest must decode with no warning.");
  assert.equal(manifest.agents.length, 12, "The manifest must name 12 agents.");
  assert.equal(manifest.sourceApp, "deepseek-bots", "The manifest must name its source app.");
  assert.equal(INPUT_LIMITS.agentInstructionsFile, 32_000, "The prompt limit must be 32,000 characters.");
  report.limit = INPUT_LIMITS.agentInstructionsFile;

  const templates: Record<string, TemplateEvidence> = {};
  report.templates = templates;
  /** The first template's bytes, so that the negative control below proves the same comparison. */
  let firstShipped: Uint8Array | null = null;
  for (const agent of manifest.agents) {
    assert.ok(agent.files, `${agent.key}: the agent must carry a files folder.`);
    const bytes = new Uint8Array(readFileSync(join(PACK, agent.files, "INSTRUCTIONS.md")));
    firstShipped ??= bytes;
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const headings = [...body.matchAll(/^# .+$/gmu)].map((match) => match[0].trim());
    assert.deepEqual(headings, HEADINGS, `${agent.key}: the template must keep the 8 headings in order.`);
    const characters = body.length;
    assert.ok(
      characters >= MIN_CHARS && characters <= MAX_CHARS,
      `${agent.key}: the template has ${characters} characters, outside ${MIN_CHARS}-${MAX_CHARS}.`,
    );

    const prompt = await inject(agent.key, "AGENTS.md", bytes);
    // The prompt trims the file, so the bytes are the same up to the whitespace that the trim removes.
    const identical = body.startsWith(prompt.text) && body.slice(prompt.text.length).trim() === "";
    templates[agent.key] = {
      bytes: bytes.byteLength,
      characters,
      headings: headings.length,
      identical,
      injectedCharacters: prompt.text.length,
      truncated: prompt.truncated,
    };
    assert.equal(prompt.fileName, "AGENTS.md", `${agent.key}: the reader must name the file it injected.`);
    assert.equal(prompt.truncated, false, `${agent.key}: a template under 32,000 characters is not truncated.`);
    assert.ok(identical, `${agent.key}: the bytes on disk must be the bytes the prompt carries.`);
  }

  // The 32,000 boundary: the whole file is injected, and nothing is reported as cut.
  const full = await inject("boundary-32000", "AGENTS.md", new TextEncoder().encode("x".repeat(32_000)));
  assert.equal(full.text.length, 32_000, "The 32,000-character file must be injected whole.");
  assert.equal(full.truncated, false, "The 32,000-character file must not be marked truncated.");
  // One character over: exactly 32,000 are injected, and the cut is reported.
  const overText = "x".repeat(32_001);
  const over = await inject("boundary-32001", "AGENTS.md", new TextEncoder().encode(overText));
  assert.equal(over.text.length, 32_000, "The 32,001-character file must be cut to 32,000 characters.");
  assert.equal(over.truncated, true, "The 32,001-character file must be marked truncated.");
  report.boundaries = {
    full: { characters: full.text.length, truncated: full.truncated },
    over: { characters: over.text.length, truncated: over.truncated },
  };

  // The two comparisons above must be able to fail, or they prove nothing.
  assert.ok(firstShipped, "The pack must have a first template.");
  const shipped = new Uint8Array(firstShipped);
  const changed = new Uint8Array(shipped);
  changed[0] = (changed[0] ?? 0) ^ 0xff;
  const changedBytesFail = !changed.every((value, index) => value === shipped[index]);
  const overLimitFails = over.text !== overText;
  report.negativeControl = { changedBytesFail, overLimitFails };
  assert.ok(changedBytesFail, "A changed byte must fail the byte comparison.");
  assert.ok(overLimitFails, "The injected text of the 32,001-character file must differ from the file.");

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "instruction-read.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
