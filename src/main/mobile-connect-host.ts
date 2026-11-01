import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { CentralAuthManager } from "./central-auth-manager";
import { RemoteWorkflowError } from "./remote-service-effects";

interface MobileConnectHostDependencies<Operation extends keyof CentralAuthManager> {
  centralAuth: Pick<CentralAuthManager, Operation>;
  host: {
    configure(input: { serverName: string }): Effect.Effect<unknown, RemoteWorkflowError>;
    getStatus(): { configured: boolean };
    getMobileConnectHost(): MobileConnectHostBinding | null;
    start(): Effect.Effect<
      {
        serverId: string | null;
        phase: string;
        apiOnline: boolean;
        apiUrl: string | null;
        message: string | null;
      },
      RemoteWorkflowError
    >;
  };
}

export const createHostedMobileConnect = Effect.fn("MobileConnectHost.create")(function* ({
  centralAuth,
  host,
}: MobileConnectHostDependencies<"createMobileConnect">) {
  return yield* centralAuth.createMobileConnect(yield* publishMobileConnectHost(host));
});

export const createHostedMobileConnectLink = Effect.fn("MobileConnectHost.createLink")(function* ({
  centralAuth,
  host,
}: MobileConnectHostDependencies<"createMobileConnectLink">) {
  return yield* centralAuth.createMobileConnectLink(yield* publishMobileConnectHost(host));
});

/** Starts the host, so the phone that uses the code can reach it, and returns its identity. */
const publishMobileConnectHost = Effect.fn("MobileConnectHost.publish")(function* (
  host: MobileConnectHostDependencies<never>["host"],
) {
  const verdict = verifyPhoneReachableMobileConnectOrigin(process.env.OPENBOT_MOBILE_AUTH_API_URL);
  if (!verdict.ok) {
    // Fail before a code is minted: a code that names an address no phone can reach wastes the
    // one-time ticket and hides the real fault behind a scanner error on the phone.
    return yield* new RemoteWorkflowError({ cause: new Error(verdict.message) });
  }
  if (!host.getStatus().configured) yield* host.configure({ serverName: "OpenBot" });
  const status = yield* host.start();
  if (!isPublishedHost(status)) {
    return yield* new RemoteWorkflowError({
      cause: new Error(status.message ?? sourceText("error.host.mobileConnectPublishFailed")),
    });
  }
  const binding = host.getMobileConnectHost();
  if (!binding || binding.hostId !== status.serverId)
    return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.mobileConnectHostChanged")) });
  return binding;
});

export type MobileConnectOriginVerdict =
  | { ok: true; origin: string }
  | {
      ok: false;
      origin: string | null;
      reason: "invalid" | "loopback" | "tailnet-http" | "public-http";
      message: string;
    };

/**
 * Decides whether the configured Mobile Connect `api` origin can reach a phone at all.
 *
 * The contract accepts HTTPS, or HTTP on a private address (`isMobileConnectDevelopmentHost`). Of those,
 * only HTTPS and a private LAN address are reachable from another device, so a loopback or public HTTP
 * origin is refused here before a ticket is created. `scripts/mobile-connect-preflight.ts` classifies the
 * same origins for the diagnostic; a test pins both to one truth table.
 */
export function verifyPhoneReachableMobileConnectOrigin(value: string | null | undefined): MobileConnectOriginVerdict {
  const raw = value?.trim() ?? "";
  if (!raw) return { ok: true, origin: "" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, origin: null, reason: "invalid", message: mobileOriginMessage(raw, "it is not a URL") };
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return {
      ok: false,
      origin: null,
      reason: "invalid",
      message: mobileOriginMessage(raw, "it is not a bare origin (a path, query or fragment is present)"),
    };
  }
  if (url.protocol === "https:") return { ok: true, origin: url.origin };
  if (url.protocol !== "http:") {
    return {
      ok: false,
      origin: null,
      reason: "invalid",
      message: mobileOriginMessage(raw, `${url.protocol} is not http or https`),
    };
  }
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    return {
      ok: false,
      origin: url.origin,
      reason: "loopback",
      message: `${mobileOriginMessage(url.origin, "it is a loopback address")} Set OPENBOT_MOBILE_AUTH_API_URL to this computer's LAN address, or to an HTTPS endpoint that forwards to this API.`,
    };
  }
  const range = ipv4RangeOf(url.hostname);
  if (range === "private") return { ok: true, origin: url.origin };
  if (range === "tailnet") {
    return {
      ok: false,
      origin: url.origin,
      reason: "tailnet-http",
      message: `${mobileOriginMessage(url.origin, "plain HTTP over a Tailscale address is not accepted by the mobile app")} Use an HTTPS endpoint, for example Tailscale Serve or a reverse proxy.`,
    };
  }
  return {
    ok: false,
    origin: url.origin,
    reason: "public-http",
    message: `${mobileOriginMessage(url.origin, "plain HTTP is accepted only on a private address")} Use HTTPS for a tunnel or a VPS.`,
  };
}

function mobileOriginMessage(origin: string, complaint: string): string {
  return `Mobile Connect cannot mint a code for ${origin}: ${complaint}.`;
}

function ipv4RangeOf(hostname: string): "private" | "tailnet" | "public" | "invalid" {
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/u.test(octet))) return "invalid";
  const values = octets.map(Number);
  if (values.some((value) => value > 255)) return "invalid";
  const [first, second] = values;
  if (first === 10 || (first === 192 && second === 168)) return "private";
  if (first === 172 && second !== undefined && second >= 16 && second <= 31) return "private";
  if (first === 100 && second !== undefined && second >= 64 && second <= 127) return "tailnet";
  return "public";
}

function isPublishedHost(status: { phase: string; apiOnline: boolean; apiUrl: string | null }): boolean {
  if (status.phase !== "online" || !status.apiOnline || !status.apiUrl) return false;
  try {
    const protocol = new URL(status.apiUrl).protocol;
    return protocol === "ws:" || protocol === "wss:";
  } catch {
    return false;
  }
}
