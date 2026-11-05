# Defense notes: Erona

How to explain each of Erona's tasks (`A-xx`) at the defense. Short, in our own words.

## A-01 Repo skeleton and frontend scaffold

- **Monorepo with npm workspaces.** One repo, one `npm install`, one lint config. Each service and the frontend is its own workspace package, so `npm test -w backend/services/auth-service` runs one service alone, but they share tooling.
- **Lint rules enforce our own rules.** ESLint fails on `console.log` (we must use the pino logger) and on `any`. Prettier formats everything the same way, so reviews are about logic, not style. `.gitattributes` forces LF line endings, because shell and SQL scripts with Windows CRLF break inside Linux containers.
- **Secrets never reach git.** `.gitignore` blocks `.env`, keys and certs. `.env.example` lists every variable with a comment and placeholder values, and is the only env file that is committed.
- **One typed API client** (`frontend/src/api/client.ts`). It adds the bearer token, parses JSON and turns the backend's standard error body into an `ApiError` with `code` and `message`, so the UI shows the server's message. The access token lives in a module variable (memory), not in localStorage. The base URL comes from `VITE_API_BASE_URL` and the app fails fast if it is missing.
- **Money formatting never uses floats.** `formatMoney` builds an exact decimal string (`12345` cents to `"123.45"`) with integer math and passes it to `Intl.NumberFormat`. It rejects non-integer cents. TypeScript is pinned to 6.0 because `typescript-eslint` does not support TypeScript 7 yet.
