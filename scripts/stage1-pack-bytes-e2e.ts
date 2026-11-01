// Measures the DeepSeek Bots pack against its policy caps and the engine limits of the agent import.
// Cases: the shipped pack is under the policy caps (2 MB, and 8 KB for `SKILL.md`), and its `SKILL.md`
// frontmatter parses with a name of 80 characters or fewer; an over-policy copy is refused by the pack
// policy while the engine still accepts it, because the 2 MB cap is policy and not an engine rule; a
// 500 MB archive is refused with the named too-large text; 5,000 entries are accepted and 5,001 are
// refused with the named expanded-too-large text; 100 channels are accepted and 101 are refused with
// the named too-many-channels text. The engine limits are reported from the contracts, not restated.
// The byte-cap case writes a sparse file of just over 500 MB and never reads it, so it costs no disk
// on a filesystem that supports sparse files.
// `bun run test:stage1-pack-bytes`. Writes .openbot-build/stage1/bytes.json.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_IMPORT_LIMITS, SKILL_DESCRIPTION_MAX_LENGTH } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { zipSync } from "fflate";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type ArchiveLimits, listEntries, readArchiveEffect } from "../src/main/agent-archive";
import { decodeImportManifest } from "../src/main/agent-import-manifest";
import { inspectSkillMarkdown } from "../src/main/skill-package";

const OUT = resolve(import.meta.dirname, "../.openbot-build/stage1");
const PACK = resolve(import.meta.dirname, "../resources/agent-import/deepseek-bots");
const MANIFEST = "openbot-import.json";
/** The Stage-1 policy caps. The engine applies neither of these. */
const POLICY = { bytes: 2 * 1024 * 1024, skillMarkdown: 8 * 1024 };
/** The same limits the import service builds, so that a refusal reads as it does in the app. */
const LIMITS: ArchiveLimits = {
  archiveBytes: AGENT_IMPORT_LIMITS.archiveBytes,
  files: AGENT_IMPORT_LIMITS.files,
  tooLarge: sourceText("error.import.zipTooLarge"),
  expandedTooLarge: sourceText("error.import.expandedTooLarge", { limit: AGENT_IMPORT_LIMITS.files }),
  invalid: sourceText("error.import.zipInvalid"),
};

interface PackSizes {
  bytes: number;
  files: number;
  manifest: number;
  skillMarkdown: number;
  largestTemplate: number;
}

const root = await mkdtemp(join(tmpdir(), "openbot-stage1-bytes-"));
const text = (value: string) => new TextEncoder().encode(value);
const newSizes = (): PackSizes => ({ bytes: 0, files: 0, manifest: 0, skillMarkdown: 0, largestTemplate: 0 });

/** Every file of a folder as an archive, so that the engine sees exactly the files on disk. */
function collect(directory: string, prefix = ""): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, collect(path, name));
    else files[name] = new Uint8Array(readFileSync(path));
  }
  return files;
}

/** The bytes and the file count of one folder, and the sizes of the manifest, the guide, and a template. */
function measure(directory: string, prefix = "", sizes: PackSizes = newSizes()): PackSizes {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      measure(path, name, sizes);
      continue;
    }
    const { size } = statSync(path);
    sizes.bytes += size;
    sizes.files += 1;
    if (name === MANIFEST) sizes.manifest = size;
    if (name === "SKILL.md") sizes.skillMarkdown = size;
    if (name.endsWith("INSTRUCTIONS.md")) sizes.largestTemplate = Math.max(sizes.largestTemplate, size);
  }
  return sizes;
}

/** The reason the pack policy refuses these sizes, or null when the pack is inside its policy. */
function policyRefusal(sizes: PackSizes): string | null {
  if (sizes.bytes > POLICY.bytes) return `the pack is ${sizes.bytes} bytes; the policy cap is ${POLICY.bytes}.`;
  if (sizes.skillMarkdown > POLICY.skillMarkdown)
    return `SKILL.md is ${sizes.skillMarkdown} bytes; the policy target is ${POLICY.skillMarkdown}.`;
  return null;
}

/** The refusal of an operation, as the text the person reads. */
async function refusal<T>(operation: Promise<T>): Promise<string> {
  const outcome = await operation.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(outcome !== null, "The import must refuse this archive.");
  return outcome;
}

/** A zip of `count` one-byte entries. */
function entries(count: number): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (let index = 0; index < count; index += 1) files[`notes/${index}.md`] = text("x");
  return zipSync(files, { level: 0 });
}

/** The pack manifest with `count` channels, and the first agent as every channel's only member. */
function manifestWithChannels(count: number): Uint8Array {
  const { manifest } = decodeImportManifest(new Uint8Array(readFileSync(join(PACK, MANIFEST))), 64);
  const first = manifest.agents[0];
  assert.ok(first, "The pack must have a first agent.");
  const channels = Array.from({ length: count }, (_, index) => ({
    key: `team-${index}`,
    name: `Team ${index}`,
    members: [first.key],
    lead: first.key,
  }));
  return new TextEncoder().encode(
    JSON.stringify({
      format: "openbot-agent-import",
      version: 1,
      source: { app: manifest.sourceApp, exportedAt: manifest.exportedAt },
      agents: manifest.agents,
      channels,
    }),
  );
}

/** The refusal that `run` gives. It fails when `run` accepts. */
function thrown(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return assert.fail("The import must refuse this input.");
}

const report: {
  passed: boolean;
  pack?: PackSizes;
  engineLimits?: { archiveBytes: number; files: number; channels: number; agents: number };
  policy?: { cap: { bytes: number; skillMarkdown: number }; benign: string | null; overPolicy: string | null };
  engineAdmitsOverPolicy?: number;
  byteCap?: { refused: string; named: boolean };
  fileCap?: { atLimit: number; overLimitRefused: string };
  channelCap?: { atLimit: number; overLimitRefused: string };
  guide?: { name: string; description: number; files: number };
  failure?: string;
} = { passed: false };

try {
  const pack = measure(PACK);
  report.pack = pack;
  assert.equal(policyRefusal(pack), null, "The shipped pack must be inside the policy caps.");
  assert.ok(pack.files < AGENT_IMPORT_LIMITS.files, "The shipped pack must be under the engine file cap.");

  const front = inspectSkillMarkdown(readFileSync(join(PACK, "SKILL.md"), "utf8"));
  report.guide = { name: front.name, description: front.description.length, files: front.files.length };
  assert.ok(front.name.length <= 80, "The guide name must be 80 characters or fewer.");
  assert.ok(front.description.length <= SKILL_DESCRIPTION_MAX_LENGTH, "The guide description is too long.");

  report.engineLimits = {
    archiveBytes: AGENT_IMPORT_LIMITS.archiveBytes,
    files: AGENT_IMPORT_LIMITS.files,
    channels: AGENT_IMPORT_LIMITS.channels,
    agents: INPUT_LIMITS.agents,
  };
  assert.equal(report.engineLimits.archiveBytes, 500 * 1024 * 1024, "The engine archive cap must be 500 MB.");
  assert.equal(report.engineLimits.files, 5_000, "The engine file cap must be 5,000 files.");
  assert.equal(report.engineLimits.channels, 100, "The engine channel cap must be 100.");

  // The policy and the engine disagree on purpose: 2 MB is this pack's policy, not an import rule.
  const copy = join(root, "pack-over-policy");
  cpSync(PACK, copy, { recursive: true });
  await writeFile(join(copy, "agents", "research-desk", "files", "large.bin"), new Uint8Array(POLICY.bytes));
  report.policy = { cap: POLICY, benign: policyRefusal(pack), overPolicy: policyRefusal(measure(copy)) };
  assert.ok(report.policy.overPolicy, "The pack policy must refuse an over-policy pack.");
  report.engineAdmitsOverPolicy = listEntries(zipSync(collect(copy), { level: 0 }), LIMITS).size;
  assert.ok(report.engineAdmitsOverPolicy > 0, "The engine accepts the over-policy pack, so the 2 MB cap is policy.");

  // The engine byte cap refuses the archive before it reads it.
  const tooBig = join(root, "too-big.zip");
  await writeFile(tooBig, "");
  await truncate(tooBig, AGENT_IMPORT_LIMITS.archiveBytes + 1);
  const byteRefused = await refusal(runCauseEffect(readArchiveEffect(tooBig, LIMITS)));
  report.byteCap = { refused: byteRefused, named: byteRefused === sourceText("error.import.zipTooLarge") };
  assert.ok(report.byteCap.named, "An archive over the byte cap must be refused with the too-large text.");

  // The engine file cap: 5,000 entries pass, 5,001 do not.
  const atFileLimit = listEntries(entries(AGENT_IMPORT_LIMITS.files), LIMITS);
  const overFiles = thrown(() => listEntries(entries(AGENT_IMPORT_LIMITS.files + 1), LIMITS));
  report.fileCap = { atLimit: atFileLimit.size, overLimitRefused: overFiles };
  assert.equal(report.fileCap.atLimit, AGENT_IMPORT_LIMITS.files, "An archive at the file cap must be accepted.");
  assert.equal(overFiles, LIMITS.expandedTooLarge, "An archive over the file cap must name the limit.");

  // The engine channel cap: 100 channels pass, 101 do not.
  const atChannelLimit = decodeImportManifest(manifestWithChannels(AGENT_IMPORT_LIMITS.channels), 64);
  const overChannels = thrown(() => decodeImportManifest(manifestWithChannels(AGENT_IMPORT_LIMITS.channels + 1), 64));
  report.channelCap = { atLimit: atChannelLimit.manifest.channels.length, overLimitRefused: overChannels };
  assert.equal(report.channelCap.atLimit, AGENT_IMPORT_LIMITS.channels, "100 channels must be accepted.");
  assert.equal(
    overChannels,
    sourceText("error.import.tooManyChannels", { limit: AGENT_IMPORT_LIMITS.channels }),
    "101 channels must be refused with the named channel limit.",
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "bytes.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
