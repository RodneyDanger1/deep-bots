// Refuses the archives and the skill folders that the agent import must never accept, through the same
// functions that the import service calls: `listEntries` for the archive entries, `decodeImportManifest`
// for the manifest limits, and `inspectArchive` for a skill folder.
// Cases: a `.env` file, a private key file, a nested archive, a `..` path, a Windows drive path, a
// `.git` folder, and a `node_modules` folder are each refused with the named unsafe-file error; a skill
// folder of 200 files is accepted and one of 201 files is refused; 32 skill paths are accepted and 33
// are refused with the named invalid-skill-list error.
// The clean pack imports: every entry is safe, the manifest decodes, and it names 12 agents and 3
// channels with no warning.
// `bun run test:stage1-archive-refusal`. Writes .openbot-build/stage1/hostile-archive.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_IMPORT_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { zipSync } from "fflate";
import { type ArchiveLimits, isUnsafeEntry, listEntries } from "../src/main/agent-archive";
import { decodeImportManifest } from "../src/main/agent-import-manifest";
import { inspectArchive } from "../src/main/skill-package";

const OUT = resolve(import.meta.dirname, "../.openbot-build/stage1");
const PACK = resolve(import.meta.dirname, "../resources/agent-import/deepseek-bots");
const MANIFEST = "openbot-import.json";
/** The skill folder limits of `skill-package.ts`: 10 MB and 200 files. */
const SKILL_FILES = 200;
/** The same limits the import service builds, so that a refusal reads as it does in the app. */
const LIMITS: ArchiveLimits = {
  archiveBytes: AGENT_IMPORT_LIMITS.archiveBytes,
  files: AGENT_IMPORT_LIMITS.files,
  tooLarge: sourceText("error.import.zipTooLarge"),
  expandedTooLarge: sourceText("error.import.expandedTooLarge", { limit: AGENT_IMPORT_LIMITS.files }),
  invalid: sourceText("error.import.zipInvalid"),
};
/** Entries that must never travel, and the words that name the case in the report. */
const UNSAFE: readonly (readonly [string, string])[] = [
  ["a .env file", "agents/research-desk/files/.env.local"],
  ["a private key file", "agents/research-desk/files/id_rsa_private.key"],
  ["a nested archive", "agents/research-desk/files/notes.zip"],
  ["a .. path", "agents/research-desk/files/../../escape.txt"],
  ["a Windows drive path", "agents/research-desk/files/C:/windows/notes.txt"],
  ["a .git folder", "agents/research-desk/files/.git/config"],
  ["a node_modules folder", "agents/research-desk/files/node_modules/tool/index.js"],
];

const text = (value: string) => new TextEncoder().encode(value);

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

/** The text of the refusal that `run` gives. It fails when `run` accepts. */
function refusal(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return assert.fail("The import must refuse this archive.");
}

/** One skill folder with `files` entries, the first of which is `SKILL.md`. */
function skillFolder(files: number): Uint8Array {
  const folder: Record<string, Uint8Array> = {
    "SKILL.md": text("---\nname: stage1-check\ndescription: A folder for the archive refusal check.\n---\nUse it.\n"),
  };
  for (let index = 1; index < files; index += 1) folder[`notes/note-${index}.md`] = text("x\n");
  return zipSync(folder);
}

/** The pack manifest with a skill list of this length on its first agent. */
function manifestWithSkills(count: number): Uint8Array {
  const { manifest } = decodeImportManifest(new Uint8Array(readFileSync(join(PACK, MANIFEST))), 64);
  const first = manifest.agents[0];
  assert.ok(first, "The pack must have a first agent.");
  const agents = manifest.agents.map((agent) =>
    agent.key === first.key
      ? { ...agent, skills: Array.from({ length: count }, (_, index) => `agents/${agent.key}/skills/skill-${index}`) }
      : agent,
  );
  return new TextEncoder().encode(
    JSON.stringify({
      format: "openbot-agent-import",
      version: 1,
      source: { app: manifest.sourceApp, exportedAt: manifest.exportedAt },
      agents,
      channels: manifest.channels,
    }),
  );
}

interface UnsafeCase {
  case: string;
  entry: string;
  refused: string;
  named: boolean;
}

const report: {
  passed: boolean;
  pack?: { files: number; agents: number; channels: number; warnings: string[] };
  unsafe?: UnsafeCase[];
  skillFolder?: { atLimit: boolean; overLimitRefused: string };
  skills?: { atLimit: boolean; overLimitRefused: string };
  failure?: string;
} = { passed: false };

try {
  const clean = packFiles();
  const bytes = new Uint8Array(readFileSync(join(PACK, MANIFEST)));
  const { manifest, warnings } = decodeImportManifest(bytes, 64);
  const entries = listEntries(zipSync(clean, { level: 6 }), LIMITS);
  report.pack = {
    files: entries.size,
    agents: manifest.agents.length,
    channels: manifest.channels.length,
    warnings,
  };
  assert.equal(entries.size, Object.keys(clean).length, "A clean pack must list every entry.");
  assert.equal(manifest.agents.length, 12, "The clean pack must name 12 agents.");
  assert.equal(manifest.channels.length, 3, "The clean pack must name 3 channels.");
  assert.deepEqual(warnings, [], "The clean pack must decode with no warning.");

  const unsafe: UnsafeCase[] = [];
  report.unsafe = unsafe;
  for (const [name, entry] of UNSAFE) {
    // The entry is unsafe on its own, before any archive is built around it.
    assert.ok(isUnsafeEntry(entry), `${name}: the entry name must be unsafe.`);
    const refused = refusal(() =>
      listEntries(zipSync({ ...clean, [entry]: text("not a real secret\n") }, { level: 6 }), LIMITS),
    );
    const named = refused === sourceText("error.import.unsafeFile", { name: entry });
    unsafe.push({ case: name, entry, refused, named });
    assert.ok(named, `${name}: the refusal must name the entry, not a generic error.`);
  }

  // The skill folder boundary: 200 files pass, 201 are refused. The limit is applied inside the unzip
  // filter, so the engine reports the invalid-zip text, which is the refusal a person sees.
  const atLimit = inspectArchive(skillFolder(SKILL_FILES));
  const overLimitRefused = refusal(() => inspectArchive(skillFolder(SKILL_FILES + 1)));
  report.skillFolder = { atLimit: atLimit.files.length === SKILL_FILES, overLimitRefused };
  assert.equal(atLimit.files.length, SKILL_FILES, "A skill folder at the 200-file limit must be accepted.");
  assert.equal(
    overLimitRefused,
    sourceText("error.skill.zipInvalid"),
    "A skill folder over the file limit must be refused with the invalid-zip text.",
  );

  // The manifest boundary: 32 skill paths pass, 33 are refused.
  const allowed = decodeImportManifest(manifestWithSkills(INPUT_LIMITS.agentSkills), 64);
  const skillCounts = allowed.manifest.agents.map((agent) => agent.skills.length);
  const overSkills = refusal(() => decodeImportManifest(manifestWithSkills(INPUT_LIMITS.agentSkills + 1), 64));
  const first = allowed.manifest.agents[0];
  assert.ok(first, "The re-encoded manifest must have a first agent.");
  const namedSkills = `Agent "${first.key}" has an invalid skill list.`;
  report.skills = { atLimit: skillCounts.includes(INPUT_LIMITS.agentSkills), overLimitRefused: overSkills };
  assert.ok(skillCounts.includes(INPUT_LIMITS.agentSkills), "A manifest at the 32-skill limit must be accepted.");
  assert.equal(overSkills, namedSkills, "A manifest over the skill limit must name the agent and the field.");

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "hostile-archive.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
