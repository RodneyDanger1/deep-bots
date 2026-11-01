import { agentProviderName, isAgentProvider } from "@openbot/contracts/ipc";
import { type AppTextKey, matchingSourceKeys } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";

/** A provider quotes what it was given, so an error can carry a whole request body back. */
const ERROR_DESCRIPTION_LIMIT = 300;
// Repeated model-refresh failures arrive as identical error events. Coalesce
// them so one outage shows one toast instead of one per retry.
const ERROR_TOAST_DEDUPE_MS = 30_000;
const lastErrorToastAt = new Map<string, number>();

/**
 * The status code that a provider quotes in the body it sends back.
 *
 * A bare number is not a code: it matches ports, byte counts and ids. A code counts only after
 * `status`, `code` or `HTTP`, or next to the word a provider writes with it, so `402 Payment
 * Required` is a billing failure and `402 ms` is a duration.
 */
const PROVIDER_STATUS =
  /(?:\bstatus(?:\s*code)?\s*[:=]?\s*|\bhttp(?:\/\d(?:\.\d)?)?\s+|\bcode\s*[:=]\s*)(\d{3})\b|\b(\d{3})\s+(?:unauthorized|payment required|forbidden|unprocessable entity|too many requests|internal server error|not implemented|bad gateway|service unavailable|gateway time-?out)\b/iu;

/** Whether the text opens like a provider's own body rather than like a sentence OpenBot wrote. */
const PROVIDER_BODY = /^\s*[<{[]|"error"\s*:|\bbody\s*[:=]\s*[<{[]/u;

/**
 * The sentence for each kind of provider refusal. A named error key is used first, when one
 * matches; these cover the body that no key describes, which used to reach the reader as is.
 */
const PROVIDER_FAILURE_TEXT = {
  body: "agent.error.providerUnreadable",
  auth: "agent.error.providerAuth",
  billing: "agent.error.providerBilling",
  rateLimit: "agent.error.providerRateLimit",
  request: "agent.error.providerRequest",
  service: "agent.error.providerUnavailable",
} as const satisfies Record<string, AppTextKey>;

type ProviderFailure = keyof typeof PROVIDER_FAILURE_TEXT;

/** Whether the message is the provider's own body, which the reader sees only through a sentence. */
function isProviderBody(message: string): boolean {
  return PROVIDER_BODY.test(message) || PROVIDER_STATUS.test(message);
}

/** The failure a provider body carries, by its status code. A body with no code is just a body. */
function providerFailure(message: string): ProviderFailure {
  const match = PROVIDER_STATUS.exec(message);
  const status = Number(match?.[1] ?? match?.[2] ?? "");
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "billing";
  if (status === 429) return "rateLimit";
  if (status === 400 || status === 422) return "request";
  if (status >= 500) return "service";
  return "body";
}

function clampReadable(text: string): string {
  if (text.length <= ERROR_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, ERROR_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

/**
 * One sentence a reader can act on, whichever surface shows it.
 *
 * A product key that the main process, a host or the backend sent keeps the copy its sender wrote:
 * the provider and status it names, and the next step for the reader. Text that is a provider's own
 * body instead becomes the sentence for that status, so a JSON body is never the message. Every
 * result is clamped, because a provider can answer with a whole request.
 */
export function readableAgentError(message: string): string {
  const { t, errorMessage, sourceText } = currentText();
  const readable = matchingSourceKeys(message).length
    ? sourceText(message)
    : isProviderBody(message)
      ? t(PROVIDER_FAILURE_TEXT[providerFailure(message)])
      : errorMessage(message, t("agent.error.continueFailed"));
  return clampReadable(readable);
}

/**
 * The readable sentence for a failure that arrives as a value, such as a rejected call. `fallback`
 * is already translated, and is used when the value holds no message to read.
 */
export function readableErrorText(error: unknown, fallback: string): string {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return message ? readableAgentError(message) : clampReadable(fallback);
}

/**
 * The toast title of an error with no agent. A provider's own failure has the code
 * `<provider>_<kind>`, such as `opencode_start_failed`, and its text often does not name the
 * provider (#2850). The message stays as it is, so its kind is still read from its start.
 */
export function providerErrorTitle(code: string): string {
  const { t } = currentText();
  const provider = code.split("_", 1)[0];
  return isAgentProvider(provider)
    ? t("agent.error.providerNamed", { provider: agentProviderName(provider) })
    : t("agent.error.provider");
}

/** True when this error text has had no toast in the last 30 seconds. The caller then shows one. */
export function claimErrorToast(text: string): boolean {
  const now = Date.now();
  if ((lastErrorToastAt.get(text) ?? 0) + ERROR_TOAST_DEDUPE_MS >= now) return false;
  lastErrorToastAt.set(text, now);
  return true;
}
