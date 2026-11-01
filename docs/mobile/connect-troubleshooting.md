# Mobile Connect: why a phone cannot reach this computer

The phone connects to the account service, then to the desktop's Mobile Connect **API origin**. That
origin is the `api` parameter of the code: `openbot://mobile-connect?api=http://192.168.1.175:3100&ticket=…`.
If the phone cannot open a TCP connection to that origin, the app shows a connection error even when the
code itself is valid. This page lists the causes in the order they are most often the real one.

## 1. See what the desktop actually offers

```powershell
bun scripts/mobile-connect-preflight.ts --json
```

It reports, read-only: the LAN address a code would use, the exact `api` origin, whether the API listens
on that address, which process owns the port, and which Windows firewall rules exist for it. Statuses:

| Status | Meaning |
| --- | --- |
| `ready` | The origin is an HTTPS endpoint, or a LAN address that the firewall already admits. |
| `warning` | A phone on the same Wi-Fi may connect, but the network profile or an unknown listener needs attention. |
| `blocked` | No phone can connect to this origin. The `reasons` list names why. |

Exit code is 0 when the report is produced. Add `--fail-on-blocked` to make status `blocked` exit 2, for
example in a release checklist. It never contacts the phone, so `ready` is not a phone test.

## 2. The two-device rule

The default development origin is `http://<this computer's LAN address>:<api port>`. That address works
only for a phone on the **same Wi-Fi or wired LAN**. Mobile data, a guest network that isolates clients,
and a VPN on the phone all fail. Two local addresses are never reachable from a phone:

- `http://127.0.0.1:<port>` and `http://localhost:<port>` — the phone resolves those to itself.
- A public IP over plain HTTP — the mobile app accepts plain HTTP only on a private address.

The core state on this computer is a LAN adapter the preflight reports as `network_profile_public`
(Windows network category `Public`). A firewall rule scoped to `Private` does not apply to it, so either
make the rule cover `Public` or set the network to `Private` — only do that for a network you trust.

## 3. Allow the listener through Windows Firewall (elevated)

The preflight names the executable that owns the API port, for example
`C:\Users\<you>\AppData\Local\Programs\...\node.exe` or `C:\Users\<you>\.bun\bin\bun.exe`. Allow that
exact program, on the profile the adapter uses, in an **Administrator** PowerShell:

```powershell
# Read what exists first (no elevation needed):
netsh advfirewall firewall show rule name=all dir=in verbose | Select-String -Pattern "Rule Name|Program|Profiles|LocalPort"

# Add the rule. Replace the profile and program path with the ones the preflight reported.
New-NetFirewallRule -DisplayName "OpenBot Mobile Connect dev" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3100 `
  -Profile Public -Program "C:\Users\<you>\.bun\bin\bun.exe"
```

Security notes:

- Scope the rule to the one TCP port the API uses and to the exact program path. Do not add a rule for
  "any program" and do not disable the firewall.
- `-Profile Public` widens exposure on untrusted networks; prefer `Private` after you set a trusted home
  network to `Private`.
- Remove the rule when you stop developing: `Remove-NetFirewallRule -DisplayName "OpenBot Mobile Connect dev"`.
- A rule for `bun.exe` does not admit a listener started by `node.exe` or `workerd.exe`. A rule admits one
  program path; the preflight compares that path with the process that owns the port.
- Windows may show a "Windows Defender Firewall has blocked some features" prompt the first time a program
  listens. Allow only on the network profile you intend.

## 4. A phone on another network: HTTPS tunnel or VPS

Plain HTTP over the LAN is a development convenience. For a phone on mobile data or another network, give
the account service an HTTPS origin that forwards to this API:

```powershell
# Tailscale Serve gives a TLS endpoint on the tailnet with a real certificate:
tailscale serve --bg --https=443 http://127.0.0.1:3100

# Then start the stack with that origin (it must be a bare origin: no path, query or fragment):
$env:OPENBOT_MOBILE_AUTH_API_URL = "https://<machine>.<tailnet>.ts.net"
bun run dev
```

- The mobile app accepts an HTTPS origin on any host. Plain HTTP over a Tailscale `100.64.0.0/10` address
  is refused by the contract, so use HTTPS there.
- On a VPS, terminate TLS with a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) in front of the API port
  and set `OPENBOT_MOBILE_AUTH_API_URL` to that HTTPS origin. Keep the origin a bare origin.
- The same rule applies to the Signal service: `REMOTE_SIGNAL_URL` must also be reachable, with
  `wss://` for a remote phone. An HTTP tunnel does not forward TURN traffic.
- Generate a **new** code after changing the origin. An existing mobile session keeps its old address.
- A public HTTPS endpoint exposes this account API to the internet. Protect it: keep the reverse proxy in
  front of only the account API port, keep the auth API's own authentication on, and remove the tunnel when
  you stop.

## 5. What the desktop UI shows

The Mobile Connect tab shows the exact `api` origin under the code, and one of these states:

- **Ready**: HTTPS origin — a phone can reach it from any network.
- **Same Wi-Fi required**: LAN HTTP origin — the phone must be on the same network.
- **Firewall may block it** (Windows, LAN origin): a phone on the same Wi-Fi still needs an inbound rule.
- **Blocked**: the origin is loopback or missing; no phone can use the code.

The permanent link is a **bearer credential**: anyone who has it can sign in as this desktop until it is
revoked, and it stops working when the desktop session that created it ends. Treat it like a password.

## 6. What is still unproven

The preflight proves the listener binds the LAN address and that a matching firewall rule exists. It cannot
prove that the phone's network reaches this computer: a router isolation setting, a managed switch, a
host-based antivirus filter, or the phone's own VPN can still block it. That last step needs the physical
phone: scan the code while both devices are on the same Wi-Fi, and if it fails, check the desktop reason
codes before changing the phone.
