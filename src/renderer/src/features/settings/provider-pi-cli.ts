import { isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
import type { AgentProviderId, ProviderRuntimeStatus } from "@openbot/contracts/ipc";

/**
 * The managed runtime that runs the key-only providers.
 *
 * Inception, DeepSeek and OpenRouter have no CLI of their own: their models run in the Pi CLI, which
 * OpenBot downloads and pins for `pi` (`agent-providers.ts`, `MANAGED_RUNTIME_PROVIDERS`). The
 * runtime snapshot is keyed by that tuple, so it has no entry for them, and the runtime store refuses
 * an action for a provider it does not manage. The row of such a provider therefore read the Pi CLI
 * status and run the Pi CLI action through this module, instead of showing no action at all.
 */
const PI_CLI_PROVIDER: AgentProviderId = "pi";

type RuntimeStatuses = Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;

/**
 * The Pi CLI runtime to show on a key-only provider's row, or undefined when the row needs none.
 *
 * Undefined once the Pi CLI is ready: the row then offers its own Connect, which opens the key
 * dialog, and a runtime status would replace that Connect with a runtime action. A Pi CLI that the
 * user installed themselves is not a download, so it is undefined too. A newer Pi CLI version is not
 * an offer on this row either: its Update action would name a provider that OpenBot does not manage,
 * so the version offer is dropped and only the install, its progress, its failure and its retry stay.
 */
export function piCliRuntime(
  provider: AgentProviderId,
  statuses: RuntimeStatuses,
  cliSource: "system" | "managed" | undefined,
): ProviderRuntimeStatus | undefined {
  if (!isKeyOnlyProvider(provider) || cliSource === "system") return undefined;
  const runtime = statuses?.[PI_CLI_PROVIDER];
  if (!runtime || runtime.phase === "ready") return undefined;
  return { ...runtime, availableVersion: null };
}

/**
 * The provider whose runtime `provider`'s download, cancel and retry act on: the Pi CLI for a
 * key-only provider, and the provider itself otherwise. A caller passes the result to the runtime
 * API, so a row never asks for a runtime that does not exist.
 */
export function piCliActionProvider(provider: AgentProviderId): AgentProviderId {
  return isKeyOnlyProvider(provider) ? PI_CLI_PROVIDER : provider;
}
