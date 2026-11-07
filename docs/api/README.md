# API specifications (OpenAPI 3)

| File                                | Service               | Owner | Status                                                                |
| ----------------------------------- | --------------------- | ----- | --------------------------------------------------------------------- |
| `auth.yaml`                         | auth-service          | Erona | Complete                                                              |
| `auction.yaml`                      | auction-service       | Erona | Complete                                                              |
| `payment.yaml`                      | payment-service       | Erona | Wallet and funds check; settlement and `GET /payments` come with A-18 |
| `bidding.yaml`, `notification.yaml` | bidding, notification | Anesa | Task B-22                                                             |

## View them

```bash
docker compose --profile docs up -d swagger-ui
```

Then open <http://localhost:8081> and pick a service. Swagger UI reads these files directly, so it
always shows what is committed; no validator service is called, so the specs never leave the
machine. To use "Try it out", add `http://localhost:8081` to `CORS_ALLOWED_ORIGINS` in `.env` and
accept the gateway certificate once (`frontend/README.md`).

## They cannot drift from the code

Each service has `src/__tests__/openapi.integration.test.ts`. It checks that every route in
`src/routes/index.ts` is documented and every documented operation exists in the running app (it
is not answered by the "route not found" handler). Adding an endpoint without documenting it, or
documenting one that does not exist, fails the tests in CI.

The tests read `paths` with a small parser for the layout used here: a path is indented two spaces
and its methods four. Keep that layout (Prettier does) when editing.
