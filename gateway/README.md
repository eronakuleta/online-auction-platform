# API gateway (Nginx)

Owner: Erona (task A-20). The only public entry point to the API: TLS, routing, rate limiting and
the `/internal` block. Files: `nginx.conf.template` (configuration), `gen-cert.sh` (local
certificate), `Dockerfile`.

```bash
docker compose up -d --build --wait
```

| URL                             | What                                |
| ------------------------------- | ----------------------------------- |
| `https://localhost:8443/api/v1` | The API (base URL for the frontend) |
| `http://localhost:8080/...`     | Redirects to the same path on HTTPS |
| `https://localhost:8443/health` | The gateway's own health check      |

The services no longer publish their own ports to the host: every API call goes through here.
Ports are bound to `127.0.0.1`, so nothing is reachable from the network.

## Routing table

Every service serves the same `/api/v1/...` path it receives, so the gateway passes the path through
unchanged.

| Path                                             | Service              | Port | Rate limit |
| ------------------------------------------------ | -------------------- | ---- | ---------- |
| `/api/v1/auctions/:id/bids`, `/state`, `/stream` | bidding-service      | 3003 | api        |
| `/api/v1/auth/*`                                 | auth-service         | 3001 | **auth**   |
| `/api/v1/users*`                                 | auth-service         | 3001 | api        |
| `/api/v1/auctions*`                              | auction-service      | 3002 | api        |
| `/api/v1/categories*`                            | auction-service      | 3002 | api        |
| `/api/v1/bids*`                                  | bidding-service      | 3003 | api        |
| `/api/v1/wallet*`, `/api/v1/payments*`           | payment-service      | 3004 | api        |
| `/api/v1/notifications*`                         | notification-service | 3005 | api        |
| any path containing `/internal`                  | blocked: `404`       |      |            |
| anything else, including services' `/health`     | `404`                |      |            |

- The first row is a regular expression, which nginx checks before the `/api/v1/auctions` prefix, so
  live bidding data goes to bidding-service and never to auction-service (ROADMAP §5).
- Services that are not built yet are already routed. Service names are looked up per request, so
  the gateway starts without them and answers `503 SERVICE_UNAVAILABLE` until they exist.
- `/internal` is checked after nginx decodes `%`-escapes and resolves `..` and `//`, so
  `/%69nternal`, `/INTERNAL` and `/api/v1/auctions/../../internal` are refused too. It gets the same
  404 as an unknown route, so the gateway does not reveal that the path exists.
- Load balancing the two bidding replicas and the SSE settings (no buffering, long timeout) are task
  A-21.

## Errors and request IDs

Errors the gateway creates itself use the standard error body (`docs/events.md` §9): `404 NOT_FOUND`,
`413 PAYLOAD_TOO_LARGE` (over 100 kB), `429 RATE_LIMITED` (with `Retry-After: 10`) and
`503 SERVICE_UNAVAILABLE` (service missing, down or too slow). Errors from a service pass through
unchanged.

Each request gets an `X-Request-Id`: the client's own if it is safe (`A-Z a-z 0-9 . _ -`, at most
128 characters), otherwise a new one. The gateway forwards it to the service, so the gateway's access
log and the service's logs show the same ID.

## Rate limits

Per client IP, set in `.env`:

| Zone   | Default                    | Applies to                       |
| ------ | -------------------------- | -------------------------------- |
| `auth` | 10 per minute, burst of 5  | login, register, refresh, logout |
| `api`  | 20 per second, burst of 40 | everything else                  |

The strict `auth` limit slows down password guessing. Load tests from one machine (B-19) will hit
the `api` limit, so raise `GATEWAY_API_RATE` and `GATEWAY_API_BURST` for them and say so in the
performance report. Per-account login throttling in auth-service is part of task A-23.

## TLS and its local limits

On first start, `gen-cert.sh` creates a self-signed certificate for `localhost` and `127.0.0.1`
(RSA 2048, valid 825 days) in `gateway/certs/`. This folder is gitignored; the key never leaves your
machine. Delete the folder and restart the gateway to make a new one. Only TLS 1.2 and 1.3 are
accepted.

**Limits, to state at the defense:**

- **Browsers warn** ("Your connection is not private"), because no trusted authority signed the
  certificate. Encryption still works, but the browser cannot confirm who it is talking to. Either
  accept the warning once, or trust `gateway/certs/cert.pem` in your operating system.
- **Every developer has a different certificate**, made on their own machine.
- **No HSTS header.** It would make browsers insist on HTTPS for `localhost` in every other project
  too, which does more harm than good for a local certificate.
- **Only `localhost` and `127.0.0.1`** are valid names, so the gateway cannot be reached securely
  from another device.
- **TLS ends at the gateway.** Traffic between the gateway and the services travels unencrypted over
  the internal Docker network, which is acceptable here because that network is not reachable from
  outside.

In production a public certificate (for example from Let's Encrypt) would replace this, together
with HSTS.

**Command-line clients:** `curl --cacert gateway/certs/cert.pem https://localhost:8443/health`.
For Node, set `NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem` (as the smoke test does). Never switch
certificate checking off instead.

**Frontend:** the Vite dev server runs on `http://localhost:5173`, a different origin from the
gateway, so the browser needs CORS headers. Those come with task A-23 (CORS allow-list), which the
frontend task A-25 needs as well.

## Test

```bash
NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:gateway
```

`tests/e2e/gateway-smoke.mjs` runs against the started stack: TLS and the redirect, every route, the
`/internal` block in six spellings, request IDs, the body limit and the login rate limit. CI runs it
on every push (the "Gateway smoke test" job).
