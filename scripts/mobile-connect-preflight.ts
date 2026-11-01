/**
 * Mobile Connect reachability preflight.
 *
 * Answers one question honestly: can a phone that scans a Mobile Connect code reach this computer?
 * It reports what it can prove locally — the LAN address, the exact QR `api` origin, whether the API
 * listens beyond loopback, the Windows firewall profile and any inbound allow rule for the port — and
 * what it cannot prove: end-to-end reachability needs a physical phone.
 *
 * Read-only. It never starts the app, never sends a packet to a phone, and never reads a ticket.
 *
 * Usage:
 *   bun scripts/mobile-connect-preflight.ts
 *   bun scripts/mobile-connect-preflight.ts --json
 *   bun scripts/mobile-connect-preflight.ts --port 3100 --json --fail-on-blocked
 */
import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import * as os from "node:os";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DEFAULT_API_PORT = 3_100;

/** How an `api` origin can reach a phone. Only two of these can: `lan-http` and `remote-https`. */
export type MobileConnectOriginKind =
  | "loopback"
  | "lan-http"
  | "remote-https"
  | "tailnet-http"
  | "public-http"
  | "invalid";

export interface MobileConnectOrigin {
  kind: MobileConnectOriginKind;
  /** The exact origin the QR carries. Null when the value is unusable. */
  url: string | null;
  detail: string;
}

/**
 * Classifies the origin that the Mobile Connect code embeds. It mirrors the contract rule: only HTTPS,
 * or HTTP on a private address, is a valid code — and of those, only HTTPS and a private LAN address
 * are reachable from another device.
 */
export function classifyMobileConnectApiOrigin(value: string | null | undefined): MobileConnectOrigin {
  const raw = value?.trim() ?? "";
  if (!raw) return { kind: "invalid", url: null, detail: "no origin configured" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "invalid", url: null, detail: "the value is not a URL" };
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return { kind: "invalid", url: null, detail: "the value is not a bare origin" };
  }
  if (url.protocol === "https:") return { kind: "remote-https", url: url.origin, detail: "HTTPS origin" };
  if (url.protocol !== "http:") {
    return { kind: "invalid", url: null, detail: `unsupported scheme ${url.protocol}` };
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return { kind: "loopback", url: url.origin, detail: "loopback address: a phone cannot reach it" };
  }
  const range = ipv4Range(url.hostname);
  if (range === "private") return { kind: "lan-http", url: url.origin, detail: "private LAN HTTP origin" };
  if (range === "tailnet") return { kind: "tailnet-http", url: url.origin, detail: "tailnet HTTP origin" };
  if (range === "public") return { kind: "public-http", url: url.origin, detail: "public HTTP origin" };
  return { kind: "public-http", url: url.origin, detail: "HTTP origin that is not a private address" };
}

/** True when the contract accepts the value as a Mobile Connect `api` origin. */
export function isContractAllowedOrigin(origin: MobileConnectOrigin): boolean {
  return origin.kind === "lan-http" || origin.kind === "remote-https";
}

/** True when another device on the same network can send a request to that origin, in principle. */
export function isPhoneReachableOrigin(origin: MobileConnectOrigin): boolean {
  return origin.kind === "lan-http" || origin.kind === "remote-https";
}

export type PreflightReasonCode =
  | "no_explicit_origin_uses_derived_lan_address"
  | "no_lan_address"
  | "api_origin_loopback"
  | "api_origin_not_usable"
  | "api_origin_https"
  | "api_not_listening"
  | "api_loopback_only"
  | "firewall_enabled"
  | "firewall_no_inbound_rule"
  | "firewall_inbound_rule_present"
  | "firewall_rule_profile_mismatch"
  | "firewall_rule_targets_other_program"
  | "firewall_rule_targets_unknown_listener"
  | "firewall_query_unavailable"
  | "network_profile_public"
  | "network_profile_unknown"
  | "tailnet_http_rejected"
  | "phone_not_tested";

export interface PreflightReason {
  code: PreflightReasonCode;
  severity: "blocked" | "warning" | "info";
  detail: string;
}

export interface FirewallRule {
  name: string;
  program: string;
  profiles: string[];
  protocol: string;
  localPort: string;
  action: string;
  /** True when the rule's profile list covers the network category the LAN adapter is on. */
  appliesToNetwork: boolean;
  /** True when the rule's program is the executable that owns the listening API port. */
  admitsListener: boolean;
}

export interface FirewallSnapshot {
  /** False when the probe could not see the firewall state at all. */
  visible: boolean;
  profiles: { domain: boolean | null; private: boolean | null; public: boolean | null };
  /** The category of the interface that carries the LAN address. */
  networkCategory: "public" | "private" | "domain" | "unknown";
  /** Enabled inbound allow rules that name a Node/Bun/Electron/OpenBot program or cover the API port. */
  matchingRules: FirewallRule[];
  /** How many inbound rules the probe could read. Zero with `visible: true` means the parse saw none. */
  inboundRulesRead: number;
  detail: string;
}

/** One socket that listens on the API port, as Windows reports it. */
export interface ListenerBinding {
  address: string;
  pid: number | null;
  processName: string | null;
  processPath: string | null;
}

export interface PreflightEnvironment {
  platform: NodeJS.Platform;
  explicitOrigin: string | null;
  apiPort: number;
  portSource: "OPENBOT_API_PORT" | "default";
  lanAddress: string | null;
  lanInterface: string | null;
  lanCandidates: { name: string; address: string }[];
  tailnetAddresses: { name: string; address: string }[];
  /** True when something accepts a TCP connection on the LAN address and the API port. */
  apiListeningOnLan: boolean | null;
  /** True when something accepts a TCP connection on 127.0.0.1 and the API port. */
  apiListeningOnLoopback: boolean | null;
  /** The processes that listen on the API port. Null when the probe could not ask. */
  listeners: ListenerBinding[] | null;
  firewall: FirewallSnapshot | null;
}

export interface PreflightReport {
  schema: "mobile-connect-preflight/v1";
  status: "ready" | "warning" | "blocked";
  origin: { kind: MobileConnectOriginKind; url: string | null; source: "explicit" | "derived" | "none" };
  environment: {
    platform: NodeJS.Platform;
    apiPort: number;
    portSource: "OPENBOT_API_PORT" | "default";
    lanAddress: string | null;
    lanInterface: string | null;
    lanCandidates: { name: string; address: string }[];
    tailnetAddresses: { name: string; address: string }[];
    apiListeningOnLan: boolean | null;
    apiListeningOnLoopback: boolean | null;
    listeners: ListenerBinding[] | null;
    firewall: FirewallSnapshot | null;
  };
  reasons: PreflightReason[];
  actions: { code: string; elevated: boolean; detail: string; command?: string }[];
  /** What this report cannot prove. A phone test is never claimed. */
  limits: string[];
}

type Ipv4Range = "private" | "tailnet" | "public" | "invalid";

function ipv4Range(hostname: string): Ipv4Range {
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

export function evaluateMobileConnectPreflight(environment: PreflightEnvironment): PreflightReport {
  const explicit = environment.explicitOrigin ? classifyMobileConnectApiOrigin(environment.explicitOrigin) : null;
  const derivedUrl =
    environment.lanAddress && environment.apiPort > 0
      ? `http://${environment.lanAddress}:${environment.apiPort}`
      : null;
  const origin = explicit ?? (derivedUrl ? classifyMobileConnectApiOrigin(derivedUrl) : null);
  const originSource = explicit ? "explicit" : origin ? "derived" : "none";
  const reasons: PreflightReason[] = [];
  const actions: PreflightReport["actions"] = [];

  if (!origin) {
    reasons.push({
      code: "no_lan_address",
      severity: "blocked",
      detail: "This computer has no private LAN address, so a derived code would name loopback.",
    });
  } else if (origin.kind === "loopback") {
    reasons.push({
      code: "api_origin_loopback",
      severity: "blocked",
      detail: `The code would carry ${origin.url ?? "loopback"}, which only this computer can reach.`,
    });
  } else if (!isContractAllowedOrigin(origin)) {
    reasons.push({
      code: origin.kind === "tailnet-http" ? "tailnet_http_rejected" : "api_origin_not_usable",
      severity: "blocked",
      detail:
        origin.kind === "tailnet-http"
          ? "HTTP over a Tailscale address is not accepted. Use an HTTPS endpoint (Tailscale Serve or a reverse proxy)."
          : `The code would carry ${origin.url ?? "an unusable origin"}, which the mobile contract refuses.`,
    });
  } else if (origin.kind === "remote-https") {
    reasons.push({
      code: "api_origin_https",
      severity: "info",
      detail: `The code carries the HTTPS origin ${origin.url}. No Windows firewall rule is needed.`,
    });
  } else if (!explicit) {
    reasons.push({
      code: "no_explicit_origin_uses_derived_lan_address",
      severity: "info",
      detail: `No OPENBOT_MOBILE_AUTH_API_URL is set, so the code uses the detected LAN address: ${origin.url}.`,
    });
  }

  if (environment.lanAddress && environment.apiListeningOnLan === false) {
    reasons.push({
      code: "api_not_listening",
      severity: "blocked",
      detail: `Nothing accepts a connection on ${environment.lanAddress}:${environment.apiPort}. Start the stack first.`,
    });
  }
  if (environment.apiListeningOnLan === false && environment.apiListeningOnLoopback === true) {
    reasons.push({
      code: "api_loopback_only",
      severity: "blocked",
      detail: "The API listens on 127.0.0.1 only. A phone cannot reach it.",
    });
  }

  const firewall = environment.firewall;
  if (firewall && !firewall.visible) {
    reasons.push({
      code: "firewall_query_unavailable",
      severity: "warning",
      detail: `The firewall state could not be read: ${firewall.detail}`,
    });
  } else if (firewall) {
    const enabled = [firewall.profiles.domain, firewall.profiles.private, firewall.profiles.public];
    const firewallOn = enabled.some((state) => state === true);
    if (firewallOn) {
      reasons.push({
        code: "firewall_enabled",
        severity: "info",
        detail: "Windows Firewall is on for at least one profile.",
      });
    }
    // A rule only matters when it covers the network category the LAN adapter is on, and only admits
    // this API when its program is the executable that owns the listening port.
    const applicable = firewall.matchingRules.filter((rule) => rule.appliesToNetwork);
    const admitting = applicable.filter((rule) => rule.admitsListener);
    if (admitting.length > 0) {
      reasons.push({
        code: "firewall_inbound_rule_present",
        severity: "info",
        detail: `An enabled inbound rule admits the listener: ${describeRules(admitting)}.`,
      });
    } else if (firewall.matchingRules.length > 0 && firewall.networkCategory !== "unknown" && applicable.length === 0) {
      reasons.push({
        code: "firewall_rule_profile_mismatch",
        severity: "blocked",
        detail: `Inbound rule(s) exist but not for the ${firewall.networkCategory} profile this adapter uses: ${describeRules(firewall.matchingRules)}.`,
      });
      actions.push(firewallAction(environment.apiPort, firewall.networkCategory));
    } else if (firewall.matchingRules.length > 0 && environment.listeners && environment.listeners.length > 0) {
      reasons.push({
        code: "firewall_rule_targets_other_program",
        severity: "blocked",
        detail: `The inbound rule(s) name another program (${describeRules(applicable.length > 0 ? applicable : firewall.matchingRules)}), and port ${environment.apiPort} is owned by ${describeListeners(environment.listeners)}.`,
      });
      actions.push(firewallAction(environment.apiPort, firewall.networkCategory));
    } else if (firewall.matchingRules.length > 0) {
      reasons.push({
        code: "firewall_rule_targets_unknown_listener",
        severity: "warning",
        detail: `Inbound rule(s) exist for ${describeRules(firewall.matchingRules)}, but nothing listens on port ${environment.apiPort}, so the program they admit is unknown. Start the dev stack, then run this preflight again.`,
      });
    } else if (firewallOn && firewall.networkCategory !== "unknown") {
      reasons.push({
        code: "firewall_no_inbound_rule",
        severity: "blocked",
        detail: `Windows Firewall allows no inbound connection to port ${environment.apiPort} or to a Node/Bun/Electron program, so a phone's request is dropped.`,
      });
      actions.push(firewallAction(environment.apiPort, firewall.networkCategory));
    }
    if (firewall.networkCategory === "public") {
      reasons.push({
        code: "network_profile_public",
        severity: "warning",
        detail:
          "The adapter that carries the LAN address is on the Public profile. A rule scoped to Private networks does not apply to it.",
      });
      actions.push({
        code: "make_network_private",
        elevated: false,
        detail:
          "Set that Wi-Fi/Ethernet network to Private, or add the rule for the Public profile too. Do not make an untrusted network Private.",
      });
    } else if (firewall.networkCategory === "unknown") {
      reasons.push({
        code: "network_profile_unknown",
        severity: "warning",
        detail: "The network category of the LAN adapter is unknown, so a Private-scoped rule cannot be confirmed.",
      });
    }
  }

  if (origin && origin.kind === "lan-http") {
    actions.push({
      code: "same_wifi",
      elevated: false,
      detail:
        "The phone must be on the same Wi-Fi or LAN as this computer. Mobile data or another network cannot reach it.",
    });
  }
  actions.push({
    code: "use_https_tunnel",
    elevated: false,
    detail:
      "For a phone on another network, set OPENBOT_MOBILE_AUTH_API_URL to an HTTPS endpoint that forwards to this API (Tailscale Serve, a VPS reverse proxy), then generate a new code.",
  });

  const blocked = reasons.some((reason) => reason.severity === "blocked");
  const warning = reasons.some((reason) => reason.severity === "warning");
  return {
    schema: "mobile-connect-preflight/v1",
    status: blocked ? "blocked" : warning ? "warning" : "ready",
    origin: { kind: origin?.kind ?? "invalid", url: origin?.url ?? null, source: originSource },
    environment: {
      platform: environment.platform,
      apiPort: environment.apiPort,
      portSource: environment.portSource,
      lanAddress: environment.lanAddress,
      lanInterface: environment.lanInterface,
      lanCandidates: environment.lanCandidates,
      tailnetAddresses: environment.tailnetAddresses,
      apiListeningOnLan: environment.apiListeningOnLan,
      apiListeningOnLoopback: environment.apiListeningOnLoopback,
      listeners: environment.listeners,
      firewall,
    },
    reasons,
    actions,
    limits: [
      "No packet is sent to a phone, and no phone is tested. End-to-end reachability needs a physical phone on the same network.",
      "A local TCP connect proves the listener binds the LAN interface; it does not prove the firewall admits an outside host.",
      "A firewall rule that admits the listening executable still lets the operating system enforce its own network rules; it is not a phone test.",
      "Reachability of an HTTPS tunnel is not tested here; check it from the phone.",
    ],
  };
}

function describeRules(rules: FirewallRule[]): string {
  return rules
    .slice(0, 3)
    .map((rule) => `"${rule.name}" (${rule.protocol}, ${rule.localPort}, ${rule.program || "any program"})`)
    .join("; ");
}

function describeListeners(listeners: ListenerBinding[]): string {
  return listeners
    .map(
      (listener) =>
        `${listener.processPath ?? listener.processName ?? `pid ${listener.pid ?? "?"}`} on ${listener.address}`,
    )
    .join(", ");
}

function firewallAction(
  port: number,
  networkCategory: FirewallSnapshot["networkCategory"],
): PreflightReport["actions"][number] {
  return {
    code: "allow_firewall",
    elevated: true,
    detail:
      "In an Administrator PowerShell, allow the executable that listens on the API port. Remove the rule when you are done.",
    command: firewallAllowCommand(port, networkCategory),
  };
}

export function firewallAllowCommand(port: number, networkCategory: FirewallSnapshot["networkCategory"]): string {
  const profiles =
    networkCategory === "public" ? "Public" : networkCategory === "unknown" ? "Private,Public" : "Private";
  return `New-NetFirewallRule -DisplayName "OpenBot Mobile Connect dev" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile ${profiles} -Program "<path to the executable that listens on ${port}>"`;
}

/** Reads the real environment, read-only. Every probe has a named failure, never a silent default. */
export async function collectPreflightEnvironment(options: {
  port?: number;
  explicitOrigin?: string | null;
}): Promise<PreflightEnvironment> {
  const interfaces = os.networkInterfaces();
  const lanCandidates = privateLanCandidates(interfaces);
  const selected = lanCandidates[0] ?? null;
  const envPort = Number.parseInt(process.env.OPENBOT_API_PORT ?? "", 10);
  const portSource: "OPENBOT_API_PORT" | "default" =
    Number.isInteger(envPort) && envPort > 0 ? "OPENBOT_API_PORT" : "default";
  const apiPort = options.port ?? (portSource === "OPENBOT_API_PORT" ? envPort : DEFAULT_API_PORT);
  const explicitOrigin = options.explicitOrigin ?? process.env.OPENBOT_MOBILE_AUTH_API_URL?.trim() ?? null;
  const listeners = readListeners(apiPort);
  return {
    platform: process.platform,
    explicitOrigin: explicitOrigin || null,
    apiPort,
    portSource,
    lanAddress: selected?.address ?? null,
    lanInterface: selected?.name ?? null,
    lanCandidates,
    tailnetAddresses: tailnetCandidates(interfaces),
    apiListeningOnLan: selected ? await tcpReachable(selected.address, apiPort) : null,
    apiListeningOnLoopback: await tcpReachable("127.0.0.1", apiPort),
    listeners,
    firewall: readFirewall(apiPort, selected?.name ?? null, listeners),
  };
}

function privateLanCandidates(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): { name: string; address: string }[] {
  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses ?? []).flatMap((address) =>
      address.family === "IPv4" && !address.internal && ipv4Range(address.address) === "private"
        ? [{ name, address: address.address }]
        : [],
    ),
  );
  return candidates.sort(
    (left, right) =>
      interfacePriority(left.name) - interfacePriority(right.name) ||
      left.name.localeCompare(right.name) ||
      left.address.localeCompare(right.address),
  );
}

function tailnetCandidates(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): { name: string; address: string }[] {
  return Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses ?? []).flatMap((address) =>
      address.family === "IPv4" && !address.internal && ipv4Range(address.address) === "tailnet"
        ? [{ name, address: address.address }]
        : [],
    ),
  );
}

/** The same ordering the dev stack uses, so this report names the address a code would use. */
function interfacePriority(name: string): 0 | 1 | 2 {
  if (name === "en0" || name === "eth0") return 0;
  if (/^(?:en|eth|wl)/u.test(name)) return 1;
  return 2;
}

/** A local TCP connect: it proves a listener binds that interface. It sends nothing to any phone. */
function tcpReachable(host: string, port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const settle = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(750, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

/** Names the processes that listen on the API port. Null when the probe is unavailable. */
export function readListeners(port: number): ListenerBinding[] | null {
  if (process.platform !== "win32") return null;
  // One `address|pid|name|path` line per socket: no JSON type assertions, and the path is what a
  // firewall rule must name.
  const script = [
    `$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq ${port} }`,
    "foreach ($connection in $connections) { $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue; $path = ''; if ($process) { try { $path = $process.Path } catch { $path = '' } }; [string]::Join('|', @($connection.LocalAddress, $connection.OwningProcess, $process.ProcessName, $path)) }",
  ].join("; ");
  const result = runWindows("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (!result.ok) return null;
  const bindings: ListenerBinding[] = [];
  for (const raw of result.output.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const [address, pid, name, path] = line.split("|");
    if (!address) continue;
    bindings.push({
      address,
      pid: Number.parseInt(pid ?? "", 10) || null,
      processName: name || null,
      processPath: path || null,
    });
  }
  return bindings;
}

export function readFirewall(
  port: number,
  lanInterface: string | null,
  listeners: ListenerBinding[] | null,
): FirewallSnapshot | null {
  if (process.platform !== "win32") return null;
  const state = runWindows("netsh.exe", ["advfirewall", "show", "allprofiles", "state"]);
  if (!state.ok) {
    return {
      visible: false,
      profiles: { domain: null, private: null, public: null },
      networkCategory: "unknown",
      matchingRules: [],
      inboundRulesRead: 0,
      detail: state.error,
    };
  }
  const profiles = parseFirewallState(state.output);
  const rules = runWindows("netsh.exe", ["advfirewall", "firewall", "show", "rule", "name=all", "dir=in", "verbose"]);
  const networkCategory = rules.ok ? readNetworkCategory(lanInterface) : "unknown";
  const matchingRules = rules.ok ? parseInboundRules(rules.output, port, listeners, networkCategory) : [];
  const inboundRulesRead = rules.ok ? countInboundRules(rules.output) : 0;
  return {
    visible: rules.ok,
    profiles,
    networkCategory,
    matchingRules,
    inboundRulesRead,
    detail: rules.ok ? "netsh advfirewall read the inbound rule list" : rules.error,
  };
}

function runWindows(file: string, args: string[]): { ok: true; output: string } | { ok: false; error: string } {
  try {
    const output = execFileSync(file, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, output };
  } catch (error) {
    // netsh exits non-zero after it has printed a complete rule list; keep the output it wrote.
    if (isProcessFailure(error)) {
      const output = typeof error.stdout === "string" && error.stdout.trim() ? error.stdout : null;
      if (output) return { ok: true, output };
      return { ok: false, error: error.message || `${file} did not answer` };
    }
    return { ok: false, error: `${file} did not answer` };
  }
}

interface ProcessFailure {
  status?: number | null;
  stdout?: string | Buffer | null;
}

function isProcessFailure(error: unknown): error is Error & ProcessFailure {
  return error instanceof Error;
}

export function parseFirewallState(output: string): FirewallSnapshot["profiles"] {
  const profiles: FirewallSnapshot["profiles"] = { domain: null, private: null, public: null };
  let current: keyof FirewallSnapshot["profiles"] | null = null;
  for (const line of output.split(/\r?\n/u)) {
    const header = /^(\w+) Profile Settings:/iu.exec(line.trim());
    if (header) {
      const name = header[1]?.toLowerCase();
      current = name === "domain" || name === "private" || name === "public" ? name : null;
      continue;
    }
    const state = /^State\s+(ON|OFF)\b/iu.exec(line.trim());
    if (state && current) profiles[current] = state[1]?.toUpperCase() === "ON";
  }
  return profiles;
}

export function countInboundRules(output: string): number {
  const matches = output.match(/^Rule Name:/gimu);
  return matches ? matches.length : 0;
}

interface NetshRuleFields {
  name: string;
  program: string;
  profiles: string;
  protocol: string;
  localPort: string;
  action: string;
  enabled: string;
  direction: string;
}

function emptyNetshRule(): NetshRuleFields {
  return { name: "", program: "", profiles: "", protocol: "", localPort: "", action: "", enabled: "", direction: "" };
}

/** netsh field names, lowercased. Unknown fields are ignored, so a verbose rule can grow. */
function applyNetshField(block: NetshRuleFields, key: string, value: string): void {
  switch (key) {
    case "rule name":
      block.name = value;
      break;
    case "program":
      block.program = value;
      break;
    case "profiles":
      block.profiles = value;
      break;
    case "protocol":
      block.protocol = value;
      break;
    case "localport":
      block.localPort = value;
      break;
    case "action":
      block.action = value;
      break;
    case "enabled":
      block.enabled = value;
      break;
    case "direction":
      block.direction = value;
      break;
    default:
      break;
  }
}

/**
 * An enabled inbound allow rule matters when it covers the API port or names a Node/Bun/Electron/OpenBot
 * program. `appliesToNetwork` and `admitsListener` then say whether it actually admits this API.
 */
export function parseInboundRules(
  output: string,
  port: number,
  listeners: ListenerBinding[] | null,
  networkCategory: FirewallSnapshot["networkCategory"],
): FirewallRule[] {
  const rules: FirewallRule[] = [];
  let block = emptyNetshRule();
  const flush = () => {
    if (
      block.name &&
      block.enabled.toLowerCase() === "yes" &&
      block.direction.toLowerCase() === "in" &&
      block.action.toLowerCase() === "allow" &&
      matchesRule(block, port)
    ) {
      rules.push({
        name: block.name,
        program: block.program,
        profiles: block.profiles
          .split(",")
          .map((profile) => profile.trim())
          .filter(Boolean),
        protocol: block.protocol,
        localPort: block.localPort,
        action: block.action,
        appliesToNetwork: profileApplies(block.profiles, networkCategory),
        admitsListener: listenerAdmitted(block.program, port, block.localPort, listeners),
      });
    }
    block = emptyNetshRule();
  };
  for (const raw of output.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^-{5,}$/u.test(line)) continue;
    const field = /^([^:]+):\s+(.*)$/u.exec(line);
    if (!field?.[1] || !field[2]) continue;
    applyNetshField(block, field[1].trim().toLowerCase(), field[2].trim());
  }
  flush();
  return rules;
}

function profileApplies(profiles: string, networkCategory: FirewallSnapshot["networkCategory"]): boolean {
  if (networkCategory === "unknown") return false;
  return (
    profiles.toLowerCase() === "any" ||
    profiles
      .split(",")
      .map((profile) => profile.trim().toLowerCase())
      .includes(networkCategory)
  );
}

function listenerAdmitted(
  program: string,
  port: number,
  localPort: string,
  listeners: ListenerBinding[] | null,
): boolean {
  if (!listeners || listeners.length === 0) return false;
  const normalizedProgram = normalizePath(program);
  // `LocalPort: Any` covers every port; a numeric or ranged value must contain this one.
  const portCovered = !localPort || localPort.toLowerCase() === "any" || portContains(localPort, port);
  if (!portCovered) return false;
  // A listener on 127.0.0.1 is never reachable from another device, so no rule can admit a phone to it.
  return listeners.some((listener) => {
    if (LOOPBACK_HOSTS.has(listener.address)) return false;
    const path = normalizePath(listener.processPath ?? "");
    if (!path || !normalizedProgram) return false;
    return path === normalizedProgram;
  });
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function matchesRule(block: NetshRuleFields, port: number): boolean {
  if (portContains(block.localPort, port)) return true;
  const program = block.program.toLowerCase();
  return /node\.exe|bun\.exe|electron|openbot/u.test(program) || /openbot|mobile connect/u.test(block.name);
}

function portContains(value: string, port: number): boolean {
  for (const part of value.split(",").map((entry) => entry.trim())) {
    if (!part) continue;
    if (/^\d+$/u.test(part) && Number(part) === port) return true;
    const range = /^(\d+)-(\d+)$/u.exec(part);
    if (range?.[1] && range[2] && port >= Number(range[1]) && port <= Number(range[2])) return true;
  }
  return false;
}

function readNetworkCategory(lanInterface: string | null): FirewallSnapshot["networkCategory"] {
  const script =
    "Get-NetConnectionProfile | ForEach-Object { [string]::Join('|', @($_.InterfaceAlias, $_.NetworkCategory)) }";
  const result = runWindows("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (!result.ok) return "unknown";
  const entries = result.output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [alias, category] = line.split("|");
      return { alias: alias?.trim() ?? "", category: category?.trim().toLowerCase() ?? "" };
    });
  const match = entries.find((entry) => entry.alias === lanInterface) ?? entries[0];
  switch (match?.category) {
    case "0":
    case "public":
      return "public";
    case "1":
    case "private":
      return "private";
    case "2":
    case "domainauthenticated":
    case "domain":
      return "domain";
    default:
      return "unknown";
  }
}

export function formatReport(report: PreflightReport): string {
  const lines = [
    `Mobile Connect preflight: ${report.status.toUpperCase()}`,
    `  code api origin: ${report.origin.url ?? "(none)"}  [${report.origin.kind}, ${report.origin.source}]`,
    `  LAN address:     ${report.environment.lanAddress ?? "(none)"}${report.environment.lanInterface ? ` (${report.environment.lanInterface})` : ""}`,
    `  API port:        ${report.environment.apiPort} (${report.environment.portSource})`,
    `  listens on LAN:  ${describeBoolean(report.environment.apiListeningOnLan)}`,
    `  firewall:        ${describeFirewall(report.environment.firewall)}`,
  ];
  for (const reason of report.reasons) lines.push(`  [${reason.severity}] ${reason.code}: ${reason.detail}`);
  for (const action of report.actions)
    lines.push(`  do: ${action.code}${action.command ? ` -> ${action.command}` : ` - ${action.detail}`}`);
  for (const limit of report.limits) lines.push(`  limit: ${limit}`);
  return `${lines.join("\n")}\n`;
}

function describeBoolean(value: boolean | null): "unknown" | "yes" | "no" {
  return value === null ? "unknown" : value ? "yes" : "no";
}

function describeFirewall(firewall: FirewallSnapshot | null): string {
  if (!firewall) return "not applicable on this platform";
  if (!firewall.visible) return `unreadable (${firewall.detail})`;
  return `${firewall.matchingRules.length} matching inbound rule(s), ${firewall.inboundRulesRead} inbound rules read, network ${firewall.networkCategory}`;
}

export interface PreflightOptions {
  json: boolean;
  failOnBlocked: boolean;
  port?: number;
  explicitOrigin?: string | null;
}

export function readPreflightOptions(argv: string[]): PreflightOptions {
  const options: PreflightOptions = { json: false, failOnBlocked: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--fail-on-blocked") options.failOnBlocked = true;
    else if (argument === "--port") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value <= 0 || value > 65_535) throw new Error("--port needs a port number.");
      options.port = value;
      index += 1;
    } else if (argument === "--origin") {
      options.explicitOrigin = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      throw new Error(
        "Usage: bun scripts/mobile-connect-preflight.ts [--json] [--fail-on-blocked] [--port <port>] [--origin <https-origin>]",
      );
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export async function main(argv: string[]): Promise<0 | 2> {
  const options = readPreflightOptions(argv);
  const report = evaluateMobileConnectPreflight(await collectPreflightEnvironment(options));
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatReport(report));
  return options.failOnBlocked && report.status !== "ready" ? 2 : 0;
}

const isEntrypoint = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/mobile-connect-preflight.ts");
if (isEntrypoint) {
  void main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
