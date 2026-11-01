import {
  createAgentTemplateShareUrl,
  OPENBOT_AGENT_TEMPLATE_PATH_PREFIX,
  parseAgentTemplateUrl,
} from "@openbot/contracts/agent-template-links";
import { parseInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import { parseMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { createPluginShareUrl, parsePluginUrl } from "@openbot/contracts/plugin-links";

export type IncomingLink =
  | { kind: "invite"; url: string }
  | { kind: "pairing"; url: string }
  | { kind: "plugin"; url: string }
  | { kind: "template"; url: string; templateId: string }
  | { kind: "invalid" };

function parseIncomingLink(value: string): IncomingLink {
  // The other link kinds have separate parsers and cannot weaken invitation validation.
  if (isInviteLink(value)) return { kind: "invite", url: value };
  try {
    const templateId = parseAgentTemplateUrl(value);
    return { kind: "template", url: createAgentTemplateShareUrl(templateId), templateId };
  } catch {
    // Not an agent link.
  }
  try {
    const pairing = mobileConnectPairingUrl(value);
    if (pairing) return { kind: "pairing", url: pairing };
    return { kind: "plugin", url: createPluginShareUrl(parsePluginUrl(value)) };
  } catch {
    return { kind: "invalid" };
  }
}

/** A Mobile Connect code: a pairing link, never an invitation for a server. */
function mobileConnectPairingUrl(value: string): string | null {
  const url = new URL(value);
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;
  return parseMobileConnectUrl(value) ? value : null;
}

/** What a scanner read: a server invitation, a Mobile Connect pairing code, or neither. */
export type ScannedLink = { kind: "invite"; url: string } | { kind: "pairing"; url: string } | { kind: "unsupported" };

/**
 * The link a scanner read. An invitation is checked first and only by its own parser, with the
 * session's account service, so adding pairing codes here cannot admit an invitation for another
 * service. A Mobile Connect code is a sign-in code for this phone, not a server invitation, so it
 * goes to the pairing screen instead of the add-server screen.
 */
export function classifyScannedLink(
  value: string,
  options: { selfHostedApiOrigin?: string | undefined } = {},
): ScannedLink {
  try {
    parseInviteUrl(value, { selfHostedApiOrigin: options.selfHostedApiOrigin });
    return { kind: "invite", url: value };
  } catch {
    // Not an invitation for this session's account service.
  }
  try {
    const pairing = mobileConnectPairingUrl(value);
    return pairing ? { kind: "pairing", url: pairing } : { kind: "unsupported" };
  } catch {
    return { kind: "unsupported" };
  }
}

/**
 * The session is not loaded when the system opens a link, so an `openbot://join` link for any
 * self-hosted account service counts as an invitation here. The add-server screen checks it again
 * with the service of the session, and refuses a link for another service.
 */
function isInviteLink(value: string): boolean {
  try {
    parseInviteUrl(value);
    return true;
  } catch {
    // Not an invitation for our service.
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "openbot:") return false;
    parseInviteUrl(value, { selfHostedApiOrigin: selfHostedApiOrigin(url.searchParams.get("api") ?? undefined) });
    return true;
  } catch {
    return false;
  }
}

// Bearer tokens never enter navigation params, persisted state, or analytics.
// The bounded memory store also keeps an invitation through the QR sign-in flow.
const requests = new Map<string, IncomingLink>();
let sequence = 0;
export function rememberIncomingLink(link: IncomingLink): string {
  if (link.kind !== "invalid") {
    for (const [id, pending] of requests) {
      if (pending.kind === link.kind && pending.url === link.url) return id;
    }
  }
  const id = String(++sequence);
  requests.set(id, link);
  if (requests.size > 8) {
    const oldest = requests.keys().next().value;
    if (oldest) requests.delete(oldest);
  }
  return id;
}

export function readIncomingLink(id: string | undefined): IncomingLink {
  return (id && requests.get(id)) || { kind: "invalid" };
}

export function forgetIncomingLink(id: string | undefined): void {
  if (id) requests.delete(id);
}

/** The newest invitation or agent link, which the screen opens again after sign-in. */
export function pendingSignInLinkId(): string | undefined {
  return [...requests].reverse().find(([, link]) => link.kind === "invite" || link.kind === "template")?.[0];
}

export function redirectIncomingLink(path: string): string {
  if (path === "openbot://" || path === "openbot:///" || path === "openbot:") return "/";
  // Expo Go and ordinary internal routes retain Expo Router's normal behavior.
  if (/^exps?:\/\//u.test(path)) return path;
  if (path.startsWith("/") && !path.startsWith("//")) {
    const url = new URL(path, "https://openbot.run");
    if (
      url.pathname !== "/join" &&
      !url.pathname.startsWith("/plugins/") &&
      !url.pathname.startsWith(OPENBOT_AGENT_TEMPLATE_PATH_PREFIX)
    )
      return path;
    path = url.toString();
  }
  return `/incoming-link?request=${rememberIncomingLink(parseIncomingLink(path))}`;
}
