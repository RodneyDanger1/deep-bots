import { describe, expect, it } from "vitest";
import { verifyPhoneReachableMobileConnectOrigin } from "../src/main/mobile-connect-host";
import { describeMobileConnectDevelopmentOrigin } from "./dev-services";
import {
  classifyMobileConnectApiOrigin,
  evaluateMobileConnectPreflight,
  type FirewallSnapshot,
  firewallAllowCommand,
  isContractAllowedOrigin,
  isPhoneReachableOrigin,
  type ListenerBinding,
  type PreflightEnvironment,
  parseFirewallState,
  parseInboundRules,
  readPreflightOptions,
} from "./mobile-connect-preflight";

const NOTEPAD = "C:\\Windows\\System32\\notepad.exe";
const BUN = "C:\\Users\\Riley\\.bun\\bin\\bun.exe";

function environment(overrides: Partial<PreflightEnvironment> = {}): PreflightEnvironment {
  return {
    platform: "win32",
    explicitOrigin: null,
    apiPort: 3100,
    portSource: "default",
    lanAddress: "192.168.1.175",
    lanInterface: "Ethernet 2",
    lanCandidates: [{ name: "Ethernet 2", address: "192.168.1.175" }],
    tailnetAddresses: [],
    apiListeningOnLan: true,
    apiListeningOnLoopback: true,
    listeners: [{ address: "0.0.0.0", pid: 42, processName: "bun", processPath: BUN }],
    firewall: firewall({}, [{ name: "bun.exe", program: BUN, protocol: "TCP", localPort: "Any" }]),
    ...overrides,
  };
}

function firewall(
  overrides: Partial<FirewallSnapshot> = {},
  rules: {
    name: string;
    program: string;
    protocol: string;
    localPort: string;
    admitsListener?: boolean;
    appliesToNetwork?: boolean;
  }[] = [],
): FirewallSnapshot {
  return {
    visible: true,
    profiles: { domain: true, private: true, public: true },
    networkCategory: "private",
    inboundRulesRead: 26,
    detail: "netsh advfirewall read the inbound rule list",
    matchingRules: rules.map((rule) => ({
      profiles: ["Private"],
      action: "Allow",
      appliesToNetwork: rule.appliesToNetwork ?? true,
      admitsListener: rule.admitsListener ?? true,
      ...rule,
    })),
    ...overrides,
  };
}

const codes = (report: ReturnType<typeof evaluateMobileConnectPreflight>) =>
  report.reasons.map((reason) => reason.code);

describe("mobile connect origin classification", () => {
  it("accepts only HTTPS and private LAN HTTP", () => {
    expect(isContractAllowedOrigin(classifyMobileConnectApiOrigin("https://phone.example.ts.net"))).toBe(true);
    expect(isContractAllowedOrigin(classifyMobileConnectApiOrigin("http://192.168.1.20:3100"))).toBe(true);
    expect(isContractAllowedOrigin(classifyMobileConnectApiOrigin("http://127.0.0.1:3100"))).toBe(false);
    expect(isContractAllowedOrigin(classifyMobileConnectApiOrigin("http://100.101.102.103:3100"))).toBe(false);
    expect(isContractAllowedOrigin(classifyMobileConnectApiOrigin("http://203.0.113.5:3100"))).toBe(false);
    expect(isContractAllowedOrigin(classifyMobileConnectApiOrigin("not a url"))).toBe(false);
  });

  it("names the transport a phone needs", () => {
    expect(classifyMobileConnectApiOrigin("http://192.168.1.20:3100").kind).toBe("lan-http");
    expect(classifyMobileConnectApiOrigin("https://vps.example.com").kind).toBe("remote-https");
    expect(classifyMobileConnectApiOrigin("http://10.0.0.4:3100").kind).toBe("lan-http");
    expect(classifyMobileConnectApiOrigin("http://172.20.1.1:3100").kind).toBe("lan-http");
    expect(classifyMobileConnectApiOrigin("http://172.32.1.1:3100").kind).toBe("public-http");
    expect(classifyMobileConnectApiOrigin("https://vps.example.com/#frag").kind).toBe("invalid");
  });

  it("agrees with the main process guard on every origin", () => {
    const values = [
      "https://phone.example.ts.net",
      "http://192.168.1.20:3100",
      "http://10.1.2.3:3100",
      "http://127.0.0.1:3100",
      "http://localhost:3100",
      "http://100.101.102.103:3100",
      "http://203.0.113.5:3100",
      "http://192.168.1.20:3100/path",
      "not a url",
    ];
    for (const value of values) {
      const preflightReachable = isPhoneReachableOrigin(classifyMobileConnectApiOrigin(value));
      expect(verifyPhoneReachableMobileConnectOrigin(value).ok, value).toBe(preflightReachable);
    }
    expect(verifyPhoneReachableMobileConnectOrigin(undefined)).toEqual({ ok: true, origin: "" });
  });

  it("refuses a loopback override before a code is minted", () => {
    const verdict = verifyPhoneReachableMobileConnectOrigin("http://127.0.0.1:3100");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("loopback");
      expect(verdict.message).toContain("LAN address");
    }
  });
});

describe("dev services origin description", () => {
  it("names the correct reason for each unusable value", () => {
    expect(describeMobileConnectDevelopmentOrigin("http://127.0.0.1:3100").kind).toBe("loopback");
    expect(describeMobileConnectDevelopmentOrigin("http://203.0.113.5:3100").kind).toBe("invalid");
    expect(describeMobileConnectDevelopmentOrigin("http://100.101.102.103:3100").kind).toBe("invalid");
    expect(describeMobileConnectDevelopmentOrigin("http://192.168.1.20:3100/v1").kind).toBe("invalid");
    expect(describeMobileConnectDevelopmentOrigin("http://192.168.1.20:3100").kind).toBe("lan-http");
    expect(describeMobileConnectDevelopmentOrigin("https://vps.example.com").kind).toBe("https");
  });

  it("returns a bare origin and no problem for a usable LAN address", () => {
    const described = describeMobileConnectDevelopmentOrigin("http://192.168.1.20:3100");
    expect(described.problem).toBeNull();
    expect(described.origin).toBe("http://192.168.1.20:3100");
    expect(described.hint).toContain("same Wi-Fi");
  });

  it("fails closed with an actionable message", () => {
    const described = describeMobileConnectDevelopmentOrigin("http://127.0.0.1:3100");
    expect(described.origin).toBeNull();
    expect(described.problem).toContain("only this computer can reach");
  });
});

describe("preflight report", () => {
  it("is ready when an applicable rule admits the listener", () => {
    const report = evaluateMobileConnectPreflight(environment());
    expect(report.status).toBe("ready");
    expect(codes(report)).toContain("firewall_inbound_rule_present");
    expect(report.origin.url).toBe("http://192.168.1.175:3100");
  });

  it("blocks a loopback origin with a named reason", () => {
    const report = evaluateMobileConnectPreflight(
      environment({ explicitOrigin: "http://127.0.0.1:3100", lanAddress: null, apiListeningOnLan: null }),
    );
    expect(report.status).toBe("blocked");
    expect(codes(report)).toContain("api_origin_loopback");
  });

  it("blocks when the firewall has no rule for the listener", () => {
    const report = evaluateMobileConnectPreflight(environment({ firewall: firewall({}, []) }));
    expect(report.status).toBe("blocked");
    expect(codes(report)).toContain("firewall_no_inbound_rule");
    expect(report.actions.find((action) => action.code === "allow_firewall")?.elevated).toBe(true);
  });

  it("blocks when the rule names a different program than the listener", () => {
    const report = evaluateMobileConnectPreflight(
      environment({
        listeners: [{ address: "0.0.0.0", pid: 7, processName: "notepad", processPath: NOTEPAD }],
        firewall: firewall({}, [
          { name: "bun.exe", program: BUN, protocol: "TCP", localPort: "Any", admitsListener: false },
        ]),
      }),
    );
    expect(report.status).toBe("blocked");
    expect(codes(report)).toContain("firewall_rule_targets_other_program");
  });

  it("warns while no process listens on the port", () => {
    const report = evaluateMobileConnectPreflight(
      environment({
        apiListeningOnLan: false,
        listeners: [],
        firewall: firewall({}, [
          { name: "bun.exe", program: BUN, protocol: "TCP", localPort: "Any", admitsListener: false },
        ]),
      }),
    );
    expect(report.status).toBe("blocked");
    expect(codes(report)).toContain("api_not_listening");
    expect(codes(report)).toContain("firewall_rule_targets_unknown_listener");
  });

  it("warns when the LAN adapter is on the Public profile", () => {
    const report = evaluateMobileConnectPreflight(
      environment({ firewall: firewall({ networkCategory: "public" }, []) }),
    );
    expect(codes(report)).toContain("network_profile_public");
    expect(report.status).toBe("blocked");
  });

  it("never claims a phone test", () => {
    const report = evaluateMobileConnectPreflight(environment());
    expect(report.limits.join(" ")).toContain("No packet is sent to a phone");
  });

  it("accepts an HTTPS tunnel origin without a firewall rule", () => {
    const report = evaluateMobileConnectPreflight(
      environment({
        explicitOrigin: "https://machine.tailnet.ts.net",
        apiListeningOnLan: null,
        firewall: firewall({ networkCategory: "unknown" }, []),
      }),
    );
    expect(report.origin.kind).toBe("remote-https");
    expect(codes(report)).toContain("api_origin_https");
    expect(codes(report)).not.toContain("firewall_no_inbound_rule");
  });
});

describe("firewall parsing", () => {
  const state = [
    "Domain Profile Settings:",
    "----------------------------------------------------------------------",
    "State                                 ON",
    "Private Profile Settings:",
    "State                                 OFF",
    "Public Profile Settings:",
    "State                                 ON",
  ].join("\r\n");

  it("reads each profile state", () => {
    expect(parseFirewallState(state)).toEqual({ domain: true, private: false, public: true });
  });

  const rules = [
    "Rule Name:                            bun.exe",
    "----------------------------------------------------------------------",
    "Enabled:                              Yes",
    "Direction:                            In",
    "Profiles:                             Private,Public",
    "Protocol:                             TCP",
    "LocalPort:                            Any",
    "Program:                              C:\\Users\\Riley\\.bun\\bin\\bun.exe",
    "Action:                               Allow",
    "",
    "Rule Name:                            Disabled sample",
    "Enabled:                              No",
    "Direction:                            In",
    "Profiles:                             Private",
    "Protocol:                             TCP",
    "LocalPort:                            3100",
    "Program:                              C:\\Windows\\System32\\notepad.exe",
    "Action:                               Allow",
  ].join("\r\n");

  const listener: ListenerBinding[] = [{ address: "0.0.0.0", pid: 1, processName: "bun", processPath: BUN }];
  const loopbackListener: ListenerBinding[] = [{ address: "127.0.0.1", pid: 1, processName: "bun", processPath: BUN }];

  it("keeps only enabled inbound allow rules that touch the port or a dev program", () => {
    const parsed = parseInboundRules(rules, 3100, listener, "public");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("bun.exe");
    expect(parsed[0]?.appliesToNetwork).toBe(true);
    expect(parsed[0]?.admitsListener).toBe(true);
  });

  it("does not admit a loopback-only listener", () => {
    const parsed = parseInboundRules(rules, 3100, loopbackListener, "private");
    expect(parsed[0]?.admitsListener).toBe(false);
  });

  it("does not apply a Private rule to a Public adapter", () => {
    const privateOnly = rules.replace(
      "Profiles:                             Private,Public",
      "Profiles:                              Private",
    );
    const parsed = parseInboundRules(privateOnly, 3100, listener, "public");
    expect(parsed[0]?.appliesToNetwork).toBe(false);
  });

  it("names the elevated command with the reported profile", () => {
    expect(firewallAllowCommand(3100, "public")).toContain("-Profile Public");
    expect(firewallAllowCommand(3100, "private")).toContain("-Profile Private");
    expect(firewallAllowCommand(3100, "unknown")).toContain("-Profile Private,Public");
  });
});

describe("arguments", () => {
  it("rejects an unknown flag instead of guessing", () => {
    expect(() => readPreflightOptions(["--nope"])).toThrow("Unknown argument");
    expect(() => readPreflightOptions(["--port", "abc"])).toThrow("--port needs a port number");
    expect(readPreflightOptions(["--json", "--fail-on-blocked", "--port", "3111"])).toEqual({
      json: true,
      failOnBlocked: true,
      port: 3111,
    });
  });
});
