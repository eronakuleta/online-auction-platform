## Task

<!-- Task ID and title from TASKS.md, e.g. A-07 auth-service register/login -->

## What changed and why

<!-- Short, plain-language summary. -->

## How to test

<!-- Commands to run and what you should see. -->

## Definition of Done (ROADMAP.md §10)

- [ ] Code is in the correct layer (no SQL in controllers, no business rules in routes)
- [ ] Input validated server-side, standard error format, correct status codes
- [ ] Tests written and passing (success, 400, 401/403/404, edge case)
- [ ] Logging added for errors and key events (no tokens or passwords logged)
- [ ] OpenAPI / `docs/events.md` updated if an endpoint or event changed
- [ ] `npm run lint` and `npm test` pass locally
- [ ] `docs/ai-usage.md` and `docs/defense-notes/<member>.md` updated
- [ ] Checkbox ticked in `TASKS.md`

## Reviewer

<!-- The other member reviews every PR. -->
