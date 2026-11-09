# Performance report — 9 November 2026

## Method and environment

Measured locally on Windows with Docker Desktop Linux containers, Node 24.15.0 and k6 0.57.0, against the actual Nginx TLS gateway, five services, PostgreSQL 16, Redis 7 and RabbitMQ 4. The load generator joins the Docker network and requests https://gateway/api/v1, avoiding Docker Desktop host-port forwarding while retaining TLS, routing and the real funds checks. The self-signed local certificate is skipped by k6 only. Requests from the host use the explicit local CA.

Browse scenarios run 30 virtual users for 15 seconds; each iteration reads the public catalog and the same auction's live state. We compare two replicas without caching, one replica with caching, and two replicas with caching. STATE_CACHE_ENABLED changes only the state cache; Redis pub/sub stays active. Each replica change waits for health and for the gateway DNS cache to settle. Only one sample per configuration was taken; workload order and shared host resources can affect the result.

The bid scenario runs **500 VUs, one iteration each**, on one freshly published auction with 500 real registered bidders and funded wallets. Amounts are 1000 + VU * 100 cents. A 201 is accepted; a 409 BID_TOO_LOW is a correct losing request under concurrency. Other status/error outcomes fail the check. The final runner checks the real closing worker, a contiguous accepted sequence, strictly increasing amounts and the winner matching the maximum submitted amount. Funds checks are real HTTP calls before the row lock; money is not reserved.

The local performance Compose override raises gateway limits so a single machine's IP is not intentionally throttled, and disables anti-sniping so the closing check completes in about a minute. Normal gateway limits, cache and two replicas are restored in finally, even after failure. Therefore these runs measure service behavior without the normal single-IP rate cap; they do not prove that 500 requests from one IP pass the default gateway policy.

## Saved measurements

HTTP durations are milliseconds; throughput is completed HTTP requests per second. Browse figures combine catalog and state requests, so they do not isolate state-only latency.

| Scenario            | Requests | Requests/s | Mean ms | p95 ms  | Checks passed |
| ------------------- | -------- | ---------- | ------- | ------- | ------------- |
| browse-no-cache     | 13734    | 912.2      | 34.81   | 81.60   | 100.0%        |
| browse-one-replica  | 20538    | 1365.6     | 24.34   | 53.51   | 100.0%        |
| browse-two-replicas | 23114    | 1538.9     | 21.12   | 44.79   | 100.0%        |
| bids-500            | 500      | 310.7      | 1146.28 | 1388.98 | 100.0%        |

Raw k6 summaries and terminal output are under [tests/performance/results](../tests/performance/results). The final bid run accepted **11** requests; the remaining **489** were expected low-bid conflicts. All 500 completed. The maximum was **51000 cents (EUR 510.00)**; the worker closed the auction as **CLOSED_SOLD** with exactly that bidder as the winner. Sequence and winner assertions passed; see [correctness.json](../tests/performance/results/correctness.json), recorded 2026-11-09T13:22:27.880Z.

Caching reduced observed browse latency in these samples, and the two cached replicas completed more requests than one. The comparison is short, local and non-randomized, so it supports a demonstration of the implementation, not a statistically controlled speedup or production capacity guarantee. SSE fan-out correctness is covered by the separate two-replica integration/gateway tests rather than a large concurrent-viewer load test.

## Failed attempts retained

The first 500-VU attempt used host.docker.internal with Docker Desktop host-port forwarding and had 185 failed request checks (63.0% passed), with connection-refused errors. It is retained as bids-500-host-forwarding.json and is **not** counted as a successful capacity result. Repeating the workload within the Docker network avoids that local forwarding path.

The next network run passed 499/500 checks. One bidder's wallet had already paid for a previous auction, so it returned INSUFFICIENT_FUNDS instead of the fixture's expected BID_TOO_LOW. That failed run is retained as bids-500-insufficient-fixture.json/.txt. The runner now tops up every reused bidder before each bid run, and the final run passes all 500 checks. The check was not weakened to hide the fixture error.

## Reproduce

Run npm ci and npm run start:stack first, then npm run perf. It creates local test accounts, deposits simulated money, scales/recreates bidding replicas for comparisons, saves measurements, verifies closing, and restores normal configuration. Allow several minutes. npm run perf -- --bids-only repeats only the bid scenario and preserves prior browse measurements. Secret bidder tokens are stored only under ignored temp/performance; that directory is excluded from Git, Docker builds and the submission archive. The runner regenerates an old fixture before its short-lived access tokens expire.
