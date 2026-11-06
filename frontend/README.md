# Frontend

React + Vite + TypeScript, React Router, TanStack Query and MUI. A thin UI over the gateway; the
backend is the authority for every rule. Owner of the auth, catalog, seller, wallet and admin pages:
Erona. Owner of the live auction, my bids and notifications pages: Anesa.

## Run it

```bash
docker compose up -d          # the API, behind the gateway at https://localhost:8443
npm run dev -w frontend       # http://localhost:5173
```

The API URL comes from `VITE_API_BASE_URL` in the repository-root `.env` (see `.env.example`).
The gateway's CORS allow-list (`CORS_ALLOWED_ORIGINS`) must contain `http://localhost:5173`.

**One-time step: trust the local certificate.** The gateway uses a self-signed certificate
(`gateway/README.md`, TLS limits). Until the browser accepts it, every API call fails with a
certificate error and the pages show "Could not reach the server". Open
<https://localhost:8443/health> once, accept the warning, and reload the app. Each browser and
each newly generated certificate needs this again.

## Structure

| Folder             | What is in it                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `src/api`          | The one HTTP client (`client.ts`) and typed wrappers per service. No `fetch` anywhere else |
| `src/components`   | Layout, `AuthProvider` (session), `RequireAuth` (route guard), shared alerts               |
| `src/hooks`        | `useAuth`, `useCategories`                                                                 |
| `src/pages/<area>` | One folder per area; areas follow the ownership table in `CLAUDE.md`                       |
| `src/utils`        | Money formatting and parsing (integer cents only), state labels                            |

## Tokens: where they live and why

| Token                     | Stored in                     | Lifetime                                          |
| ------------------------- | ----------------------------- | ------------------------------------------------- |
| Access token (JWT, RS256) | Memory only (`api/client.ts`) | 15 minutes; refreshed 60 s before it expires      |
| Refresh token             | `sessionStorage`              | Until used once (it rotates) or the tab is closed |

**Trade-off.** Keeping the access token in memory means no script can find an old one in storage,
and a reload restores the session from the refresh token. `sessionStorage` survives a reload but not
closing the tab. Its weakness: a script injected into the page (XSS) could read the refresh token
and use it from anywhere. Two things limit that: the token works only once (rotation), and if an
already used token comes back the server revokes the whole session (reuse detection, task A-07).
An `httpOnly` cookie would hide the token from scripts, but needs CSRF protection and cookie
handling at the gateway, which is out of scope. XSS itself is kept unlikely because React escapes
everything it renders and no page renders server text as HTML. The page itself has no
Content-Security-Policy yet (the API's helmet headers protect API answers, not this page); adding
one where the built app is served is a known gap.

**One refresh at a time.** Because a refresh token works once, two refreshes running together would
make the second look like theft and end the session. `AuthProvider` therefore shares one in-flight
refresh between startup, the timer, the retry after a `401` and React StrictMode's double effects.

## Rules the code follows

- Server state only through TanStack Query, with loading and error states on every page.
- Errors show the server's `code` and `message` (`ErrorAlert`); the UI adds light checks only.
- Route guards (`RequireAuth`, optionally with roles) shape the UI; the server checks again.
- Money is integer cents end to end: `parseMoneyToCents` reads input without floats, and
  `formatMoney` is the one place that turns cents into text.
- The catalog's filters live in the URL, so searches can be shared and the back button works.
