// Checks the one compaction threshold source of P1-7, and the payload that feeds it. It runs the real
// `deepseek` provider driver against the fake Pi `provider-fakes/agents/deepseek-api.ts` with 850,000
// counted tokens in a 1,048,576 window; the captured `thread/tokenUsage/updated` is the exact shape the
// budget arm of `turn-lifecycle.ts` reads.
//
// The discriminating case is 850K of 1M (0.8106): the old literal 0.8 compacts there and the DeepSeek
// 0.9 does not, so a change of the threshold changes the outcome. Controls that must not move:
// a 200K window, a 1M window of another provider, a 1M window with no model, and a window of 0.
// `bun run test:deepseek-compaction-threshold`. Writes
// .openbot-build/deepseek-compaction-threshold-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { contextCompactionThreshold } from "../src/backend/agent/context-compaction";
import type { AgentClient } from "../src/backend/agent-client";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/deepseek-compaction-threshold-e2e");
const WINDOW = 1_048_576;
const USED = 850_000;
const COUNTERS = { input: 400_000, output: 100_000, cacheRead: 300_000, cacheWrite: 50_000 };

interface ThresholdCase {
  name: string;
  window: number;
  model: string | null;
  expected: number;
}
interface Report {
  passed: boolean;
  producer?: {
    used: number | null;
    window: number | null;
    model: string | null;
    threshold: number;
    compacts: boolean;
  };
  threshold?: ThresholdCase[];
  discriminator?: { ratio: number; legacyCompacts: boolean; deepseekCompacts: boolean };
  smallWindow?: { ratio: number; threshold: number; compacts: boolean };
  failure?: string;
}

const report: Report = { passed: false };
const root = await mkdtemp(join(tmpdir(), "openbot-deepseek-threshold-"));
const workspace = join(root, "workspace");
const clients: AgentClient[] = [];
await mkdir(workspace, { recursive: true });

try {
  // The policy table: only a DeepSeek model at the 1M window moves off 0.8.
  const cases: ThresholdCase[] = [
    { name: "deepseek-1M", window: WINDOW, model: "deepseek-v4-pro", expected: 0.9 },
    { name: "pi-deepseek-1M", window: WINDOW, model: "deepseek/deepseek-v4-pro", expected: 0.9 },
    { name: "deepseek-850K-window", window: 850_000, model: "deepseek-v4-pro", expected: 0.8 },
    { name: "deepseek-200K-window", window: 200_000, model: "deepseek-v4-pro", expected: 0.8 },
    { name: "claude-1M", window: WINDOW, model: "claude-fable-5-1[1m]", expected: 0.8 },
    { name: "no-model-1M", window: WINDOW, model: null, expected: 0.8 },
    { name: "no-window", window: 0, model: "deepseek-v4-pro", expected: 0.8 },
    { name: "invalid-window", window: Number.NaN, model: "deepseek-v4-pro", expected: 0.8 },
  ];
  report.threshold = cases;
  for (const candidate of cases)
    assert.equal(
      contextCompactionThreshold(candidate.window, candidate.model),
      candidate.expected,
      `${candidate.name} must compact at ${candidate.expected}.`,
    );

  // The discriminator the plan asks for: 850K of 1M is above 0.8 and below 0.9.
  const ratio = USED / WINDOW;
  const discriminator = {
    ratio,
    legacyCompacts: ratio >= 0.8,
    deepseekCompacts: ratio >= contextCompactionThreshold(WINDOW, "deepseek-v4-pro"),
  };
  report.discriminator = discriminator;
  assert.equal(discriminator.legacyCompacts, true, "0.8 must compact at 850K of 1M.");
  assert.equal(discriminator.deepseekCompacts, false, "0.9 must not compact at 850K of 1M.");

  // A small window compacts at its own ratio, with the same 0.8.
  const small = { ratio: 170_000 / 200_000, threshold: contextCompactionThreshold(200_000), compacts: false };
  small.compacts = small.ratio >= small.threshold;
  report.smallWindow = small;
  assert.equal(small.threshold, 0.8);
  assert.equal(small.compacts, true, "A 200K window must compact at 85% of itself.");

  // The real producer of the numbers that the budget arm reads.
  const executablePath = join(root, "bin", "pi");
  const log = join(root, "fake.jsonl");
  const executable = await installFakeAgent(executablePath, "deepseek-api", {
    FAKE_LOG: log,
    FAKE_DIR: root,
    FAKE_MODE: "reply",
    FAKE_STATS: JSON.stringify(COUNTERS),
    FAKE_CONTEXT_WINDOW: String(WINDOW),
    FAKE_REPLY: "done",
  });
  const client = requireProviderDriver("deepseek").createClient(
    { executable, version: "1.4.0", source: "managed" },
    60_000,
    {
      apiKey: () => "deepseek-e2e-test-key",
      customProviders: () => [],
      mcpServers: () => [],
      providerStateDirectory: join(root, "state"),
    },
  );
  clients.push(client);
  const notifications: AppServerNotification[] = [];
  client.on("notification", (notification) => notifications.push(notification));
  client.start();
  const thread = await startThread(client, { cwd: workspace, model: "deepseek-v4-pro" });
  const turn = await runTurn(client, thread, { text: "count" });
  assert.equal(turn.error, null, `The turn failed: ${turn.error}`);
  const event = notifications.find(
    (entry) => entry.method === "thread/tokenUsage/updated" && getString(entry.params, "threadId") === thread,
  );
  const params = event?.params;
  assert.ok(isRecord(params), "The turn must send thread/tokenUsage/updated.");
  const tokenUsage = getRecord(params, "tokenUsage");
  const last = getRecord(tokenUsage, "last");
  const model = getString(params, "model");
  assert.equal(last?.totalTokens, USED, "The arm must read the counted tokens.");
  assert.equal(tokenUsage?.modelContextWindow, WINDOW, "The arm must read the window.");
  assert.equal(model, "deepseek-v4-pro");
  const threshold = contextCompactionThreshold(WINDOW, model);
  const producer = {
    used: typeof last?.totalTokens === "number" ? last.totalTokens : null,
    window: typeof tokenUsage?.modelContextWindow === "number" ? tokenUsage.modelContextWindow : null,
    model,
    threshold,
    compacts: USED / WINDOW >= threshold,
  };
  report.producer = producer;
  assert.equal(threshold, 0.9);
  assert.equal(producer.compacts, false, "The captured payload must not compact at the DeepSeek 0.9.");

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
