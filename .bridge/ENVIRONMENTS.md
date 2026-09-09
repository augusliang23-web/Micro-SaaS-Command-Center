# Environments

| Environment | Evidence | Authority |
|---|---|---|
| AI Studio Preview | Observed Prototype surface only | Non-production visual reference |
| Local Command Center runtime | Local loopback state, read-only GitHub signals, and V0.4 Codex proposal handoff | Development-only; not a deployment or approval authority |
| Development | No verified deployment evidence | Not established |
| Staging / UAT | Fixture copy only | Not established |
| Production | Fixture copy only | Not established |

The local Codex handoff is constrained to development mode, an expected
loopback origin, and a server-side local allowlist. Its read-only proposal
capability does not establish Development, UAT, or Production, and it does not
authorize provider writes, deployment, release, or human approval.

`npm run test:ui` is local Vite frontend verification; it is not a deployment
and does not establish an API, UAT, or Production environment.
