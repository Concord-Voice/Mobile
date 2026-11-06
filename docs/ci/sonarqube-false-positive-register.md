# SonarQube False Positive Register

This file records every SonarQube finding in this repo that is marked
`FALSE_POSITIVE`, with the reason. It follows the same rules as the registers
in the other Concord Voice repos.

SonarQube AI-Code Assurance is on, so rules are never disabled or tuned. Each
false positive is marked on its own, with a comment in SonarQube that points
here. `ACCEPTED` findings (real, not fixed yet) go in GitHub issues, not here.

## Rule-Calibration Notes

### `typescript:S2245` — `Math.random` for a non-secret pairing value

| Field | Value |
|---|---|
| First recorded | 2026-11-06 (default-profile sweep) |
| Rationale | The value only pairs an outgoing send with its acknowledgement: `DmSocket` accepts an ack only when its nonce matches. It is never key material, a token, an encryption nonce or a session id. The ack arrives on the server's own WebSocket, which is `wss://` because it is derived from the HTTPS API base. Anyone able to inject frames there can already forge any frame, so predicting the value gives them nothing extra. |
| Disposition | Per-instance `FALSE_POSITIVE` when the value has no security role. Any security-relevant random value must use the platform CSPRNG. Rule-level disable is prohibited by project SonarQube AI-Code Assurance policy. |

## Instance-Specific Entries

| # | Date | Issue key | Rule | Location | Marker | Justification |
|---|---|---|---|---|---|---|
| 1 | 2026-11-06 | `AaGTKpn8E-Km-bl-YXHN` | `typescript:S2245` | `src/state/conversation.ts` (reported at line 59; the call now sits near line 95) | Claude (Mark approved 2026-11-06) | Send/ack pairing value; forging an ack already needs frame injection on the TLS socket. Note `typescript:S2245` above. |

## Schema Rules

1. Rows are append-only and numbered in order. Never renumber or delete a row.
2. If a false positive is reopened, strike through the row's cells and add
   `**Reopened YYYY-MM-DD (reason)**` after the justification.
3. Dates are ISO `YYYY-MM-DD`, the day the finding was marked.
