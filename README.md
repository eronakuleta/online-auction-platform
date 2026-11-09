# Online Auction Platform

## Dokumentimi i instalimit dhe ekzekutimit

**Lënda:** Ueb Shërbime dhe Ueb APIs

**Gjendja e analizuar:** 09.11.2026; përditësuar pas integrimit në `development`

**Versioni i projektit:** `0.1.0`

Ky dokument përshkruan implementimin aktual dhe mënyrën e instalimit, konfigurimit, nisjes dhe verifikimit të tij. Ai mbulon dokumentimin e kërkuar nga seksionet 9, 10, 11 dhe kriteri përkatës në seksionin 13 të kërkesave të lëndës. Kërkesat akademike janë përdorur si pikë krahasimi; funksionet e planifikuara nuk trajtohen si funksione të realizuara.

> **Kufiri i verifikimit fillestar, para integrimit:** lint-i, kontrolli TypeScript, build-i dhe nisja lokale e frontend-it u verifikuan me sukses. Docker CLI nuk ishte i disponueshëm në terminalin e verifikimit. Lidhja reale PostgreSQL dhe kërkesat HTTPS ndaj gateway përfunduan me timeout, përfshirë një provë jashtë sandbox-it. Instalimi nga zero, nisja e plotë me Compose dhe ekzekutimi funksional i backend-it mbeten për t'u verifikuar në një mjedis me infrastrukturë aktive. Nuk pretendohet se të gjitha testet kalojnë.

### Nisje e shpejtë pas integrimit

Nga rrënja, me Node.js 24, npm 10+ dhe Docker Compose v2 aktiv:

```powershell
npm.cmd ci
npm.cmd run start:stack
docker compose ps
npm.cmd run dev -w frontend
```

`start:stack` kopjon `.env.example` vetëm kur `.env` mungon, gjeneron çelësat kur mungojnë, nis infrastrukturën dhe ndërton shërbimet duke pritur healthcheck-et. Në Linux kontrolloni lejet e çelësit sipas seksionit 5.3. Hapni [gateway health](https://localhost:8443/health), pranoni certifikatën lokale dhe pastaj hapni [frontend-in](http://localhost:5173).

```powershell
npm.cmd run test:stack
npm.cmd run test:collection
docker compose --profile monitoring --profile docs up -d
```

`test:stack` ekzekuton testet gateway në rend dhe vendos certifikatën automatikisht. [Prometheus](http://localhost:9090) monitoron shërbimet dhe replikat; [Swagger UI](http://localhost:8081) shfaq pesë specifikimet. Për query Prometheus provoni `up`, `sum by (service) (rate(http_requests_total[1m]))` ose `histogram_quantile(0.95, sum by (le, service) (rate(http_request_duration_seconds_bucket[5m])))`.

Rezultatet e verifikimit fillestar më poshtë janë historike. [Raporti i integruar i testeve](docs/test-report.md) regjistron 873 teste workspace, 83 kontrolle stack dhe 29 kontrolle të koleksionit API të kaluara në ekzekutimet e përshkruara atje; ato nuk u riekzekutuan gjatë zgjidhjes së konfliktit. Shihni edhe [performancën](docs/performance-report.md), [Bruno](tests/api-collection/README.md), [demonstrimin](docs/defense-notes/erona-demo.md), [mbrojtjen](docs/defense-notes/anesa.md) dhe [deklarimin e asistencës AI](docs/ai-usage.md).

## Përmbajtja

1. [Hyrje](#1-hyrje)
2. [Teknologjitë e përdorura](#2-teknologjitë-e-përdorura)
3. [Kërkesat paraprake](#3-kërkesat-paraprake)
4. [Struktura e projektit](#4-struktura-e-projektit)
5. [Marrja e projektit dhe instalimi](#5-marrja-e-projektit-dhe-instalimi)
6. [Konfigurimi i variablave të mjedisit](#6-konfigurimi-i-variablave-të-mjedisit)
7. [Konfigurimi i bazës së të dhënave](#7-konfigurimi-i-bazës-së-të-dhënave)
8. [Nisja dhe ekzekutimi i aplikacionit](#8-nisja-dhe-ekzekutimi-i-aplikacionit)
9. [Verifikimi i funksionalitetit](#9-verifikimi-i-funksionalitetit)
10. [Ekzekutimi i testeve](#10-ekzekutimi-i-testeve)
11. [Problemet e mundshme dhe zgjidhjet](#11-problemet-e-mundshme-dhe-zgjidhjet)
12. [Ndalimi dhe rinisja e aplikacionit](#12-ndalimi-dhe-rinisja-e-aplikacionit)
13. [Përfundim](#13-përfundim)
14. [Çështjet e mbetura për përfundim](#14-çështjet-e-mbetura-për-përfundim)

## 1. Hyrje

Online Auction Platform është një platformë ankandesh me arkitekturë mikroshërbimesh. Ajo përmban shërbime për përdoruesit dhe autentikimin, katalogun dhe ciklin e ankandeve, ofertimin, kuletat dhe shlyerjen e pagesave të simuluara, si dhe njoftimet brenda aplikacionit. Rolet janë `ADMIN`, `SELLER` dhe `BIDDER`. Regjistrimi krijon përdorues me rolin `BIDDER`; rolin `SELLER` e cakton administratori përmes API-së.

Frontend-i përdor React dhe komunikon me backend-in përmes gateway Nginx. PostgreSQL ruan të dhënat në pesë baza të veçanta; RabbitMQ shërben për ngjarjet ndërmjet shërbimeve, ndërsa Redis për cache dhe shpërndarjen e përditësimeve live ndërmjet replikave të ofertimit. Shumat monetare përfaqësohen me numra të plotë në centë.

### 1.1 Gjendja aktuale e implementimit

Në tabelë, **i implementuar** do të thotë se ekziston kodi përkatës dhe, kur aplikohet, testet; nuk do të thotë automatikisht se funksioni është verifikuar në një sistem të nisur gjatë këtij kontrolli.

| Fusha                                                                                      | Gjendja                    | Evidenca dhe kufiri                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regjistrimi, login, refresh, logout, profili dhe administrimi i përdoruesve                | I implementuar             | `backend/services/auth-service/src/`; JWT RS256, argon2id, RBAC dhe login throttling; ekzekutimi real i API-së nuk u konfirmua                              |
| Kategoritë, katalogu, filtrimi, krijimi, ndryshimi, publikimi dhe anulimi i ankandeve      | I implementuar             | `backend/services/auction-service/src/`; specifikim OpenAPI dhe teste integrimi                                                                             |
| Vendosja e ofertave, kontrolli i fondeve, idempotenca, anti-sniping dhe mbyllja automatike | I implementuar             | `backend/services/bidding-service/src/`; përfshihen teste konkurrence me 50 kërkesa paralele; rezultatet e integruara dokumentohen në `docs/test-report.md` |
| Gjendja live, historiku, ofertat personale dhe SSE                                         | I implementuar             | Backend dhe faqet `auction-live`, `my-bids` ekzistojnë                                                                                                      |
| Kuleta, depozita dhe shlyerja pas përfundimit të ankandit                                  | I implementuar             | `payment-service`; pagesa të simuluara, pa integrim bankar                                                                                                  |
| Njoftimet nga ngjarjet dhe shënimi si të lexuara                                           | I implementuar             | Backend, faqja e njoftimeve dhe notification bell ekzistojnë                                                                                                |
| Frontend: autentikim, profil, katalog, detaje, menaxhim nga shitësi dhe kuletë             | I implementuar             | Routes në `frontend/src/App.tsx`; build dhe serveri Vite u verifikuan, por rrjedhat me backend nuk u verifikuan                                             |
| Frontend për ofertim live, ofertat personale dhe njoftimet                                 | I implementuar             | Routes `/auctions/:id/live`, `/my-bids`, `/notifications` në `App.tsx`                                                                                      |
| Gateway HTTPS, CORS, rate limiting dhe replikimi i bidding                                 | I konfiguruar              | `gateway/` dhe `docker-compose.yml`; parazgjedhja është dy replika; nisja reale nuk u verifikua                                                             |
| Dokumentimi OpenAPI                                                                        | I implementuar             | Pesë specifikimet auth, auction, bidding, payment dhe notification                                                                                          |
| Monitorimi                                                                                 | I implementuar             | `/health`, `/metrics`, log-e JSON dhe profil Compose `monitoring` me Prometheus                                                                             |
| CI/CD dhe Kubernetes                                                                       | I pjesshëm / mungon        | GitHub Actions CI ekziston; Kubernetes dhe një pipeline shpërndarjeje nuk gjenden në repository                                                             |
| Testimi i performancës dhe raportet                                                        | I implementuar me kufizime | k6, Bruno dhe raportet ekzistojnë; objektivi p95 i ofertimit nuk është arritur                                                                              |

## 2. Teknologjitë e përdorura

Versionet e paketave më poshtë janë marrë nga `package-lock.json` dhe u krahasuan me `npm.cmd ls --depth=0`. Etiketat Docker janë marrë nga Dockerfile-t dhe Compose; ato nuk provojnë versionin e një image të ekzekutuar.

| Teknologjia / mjeti        | Versioni ose kërkesa                            | Përdorimi                                                          |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| Node.js                    | `>=24 <25`; `.nvmrc`: `24`; lokalisht `24.15.0` | Backend, frontend tooling dhe testet                               |
| npm                        | `>=10`; lokalisht `11.12.1`                     | Workspaces dhe instalimi nga lockfile                              |
| TypeScript                 | `6.0.3`                                         | Backend dhe frontend                                               |
| Express                    | `5.3.0`                                         | API REST                                                           |
| PostgreSQL                 | Image `postgres:16`                             | Pesë baza të shërbimeve                                            |
| `pg`                       | `8.23.1`                                        | SQL dhe transaksionet                                              |
| Redis / klienti Node       | Image `redis:7-alpine` / `6.3.0`                | Cache dhe pub/sub për SSE                                          |
| RabbitMQ / `amqplib`       | Image `rabbitmq:4-management` / `2.2.1`         | Ngjarjet asinkrone                                                 |
| Nginx                      | Image `nginx:1.28-alpine`                       | Gateway dhe TLS                                                    |
| React / React DOM          | `19.3.1`                                        | Ndërfaqja e përdoruesit                                            |
| Vite                       | `8.3.5`                                         | Serveri zhvillimor dhe build-i i frontend-it                       |
| React Router               | `8.5.1`                                         | Navigimi                                                           |
| TanStack Query             | `5.105.0`                                       | Të dhënat e marra nga API                                          |
| MUI                        | `9.5.0`                                         | Komponentët e ndërfaqes                                            |
| Zod / Helmet               | `4.6.7` / `8.3.0`                               | Validimi dhe HTTP security headers                                 |
| argon2 / jsonwebtoken      | `0.45.2` / `9.0.3`                              | Fjalëkalimet dhe JWT RS256                                         |
| Pino                       | `10.4.0`                                        | Log-e JSON me correlation ID                                       |
| Jest / ts-jest / Supertest | `30.5.2` / `29.4.15` / `7.3.1`                  | Teste unit dhe integrimi                                           |
| Node test runner           | I integruar në Node.js 24                       | Testet E2E dhe të sigurisë                                         |
| ESLint / Prettier          | `10.14.0` / `3.9.10`                            | Kontrolli i kodit dhe formatimi                                    |
| Swagger UI                 | Image `swaggerapi/swagger-ui:v5.17.14`          | Shfaqja lokale e OpenAPI                                           |
| Docker / Docker Compose    | Versioni minimal nuk është fiksuar              | Container-at; kërkohet Compose v2 me `--wait` dhe `--wait-timeout` |

Imazhet e backend-it bazohen në `node:24-bookworm-slim`. Disa etiketa Docker fiksojnë vetëm versionin kryesor dhe nuk janë të fiksuara me digest.

## 3. Kërkesat paraprake

Për instalimin e rekomanduar nevojiten:

- Git, nëse projekti merret me clone; alternativisht arkivi i kodit burimor.
- Node.js 24.x dhe npm 10 ose më i ri.
- Docker Engine me Docker Compose v2, ose Docker Desktop me Linux containers. Docker duhet të jetë aktiv para nisjes së infrastrukturës.
- Një shfletues modern dhe terminal PowerShell, Bash ose ekuivalent.
- Internet për instalimin fillestar të paketave npm dhe shkarkimin e Docker images. Fotot demo referojnë URL të jashtme; pa internet mund të mos shfaqen.
- Portat lokale të lira të seksionit 8, veçanërisht `5173`, `5433`, `6379`, `5672`, `15672`, `8080` dhe `8443`.

Nuk kërkohen shërbime pagesash, SMTP apo llogari cloud për rrjedhën aktuale. Nuk ka konfigurim aktiv MailHog, ndonëse `.env.example` përmban variabla SMTP të rezervuara për një zgjerim.

Nga rrënja e projektit kontrolloni:

```powershell
node --version
npm.cmd --version
git --version
docker --version
docker compose version
docker info
```

Në Windows, `npm.cmd` shmang bllokimin e `npm.ps1` nga PowerShell Execution Policy. Në Bash/Linux/macOS përdorni `npm` në vend të `npm.cmd`. Komandat në vijim përdorin PowerShell, përveç rasteve të shënuara ndryshe. Projekti nuk përcakton kërkesa numerike RAM/CPU; kapaciteti duhet verifikuar në kompjuterin e demonstrimit.

## 4. Struktura e projektit

```text
online-auction-platform/
├── .github/workflows/ci.yml       # Kontrollet CI, SQL dhe testet përmes gateway
├── backend/
│   ├── services/
│   │   ├── auth-service/
│   │   ├── auction-service/
│   │   ├── bidding-service/
│   │   ├── payment-service/
│   │   └── notification-service/
│   └── shared/
│       ├── auth/                  # JWT, middleware, role dhe gjenerimi i çelësave
│       └── common/                # Gabimet, log-et dhe RabbitMQ
├── database/
│   ├── init-databases.sh
│   ├── auth/                      # 001_schema.sql, 002_seed.sql, 003_login_throttling.sql
│   ├── auction/                   # 001_schema.sql, 002_seed.sql, 003_catalog_indexes.sql
│   ├── bidding/                   # 001_schema.sql dhe 002_seed.sql
│   ├── payment/                   # 001_schema.sql dhe 002_seed.sql
│   └── notification/              # 001_schema.sql dhe 002_seed.sql
├── frontend/                      # React, Vite, routes, API client dhe faqet
├── gateway/                       # Nginx, CORS dhe gjenerimi i certifikatës lokale
├── monitoring/                    # prometheus.yml dhe DNS discovery për replikat
├── scripts/                       # manage.mjs, test-stack.mjs, performance.mjs dhe ndihmësit
├── tests/
│   ├── e2e/                       # Gateway, events, wallet, settlement, lifecycle, replikimi
│   └── security/                  # Testet e sigurisë
├── docs/                          # Arkitektura, kërkesat, ngjarjet dhe evidencat ekzistuese
│   └── api/                       # OpenAPI për pesë shërbimet
├── secrets/                       # Çelësa lokalë të gjeneruar; jashtë Git
├── .env.example                   # Modeli publik i konfigurimit
├── docker-compose.yml
├── package.json                   # npm workspaces dhe komandat e përbashkëta
├── package-lock.json              # Versionet e sakta të varësive
├── TASKS.md
├── ROADMAP.md
└── README.md
```

Mikroshërbimet ndajnë përgjegjësitë në `routes`, `controllers`, `schemas`, `services`, `repositories` dhe, sipas shërbimit, `events`, `clients` ose `jobs`. Pika e nisjes është `src/server.ts`; `src/app.ts` ndërton aplikacionin Express për përdorim edhe nga testet. Testet Jest gjenden në `src/__tests__/` brenda workspaces.

Dokumentacion plotësues: [arkitektura](docs/architecture.md), [kërkesat e projektit](docs/requirements.md), [ngjarjet](docs/events.md), [gateway](gateway/README.md), [frontend](frontend/README.md), [OpenAPI](docs/api/README.md) dhe [testet e sigurisë](tests/security/README.md). Planet dhe shënimet e mëparshme nuk zëvendësojnë gjendjen e kodit ose rezultatet aktuale.

## 5. Marrja e projektit dhe instalimi

### 5.1 Marrja e kodit

Në dosjen ku dëshironi të ruani projektin:

```powershell
git clone https://github.com/eronakuleta/online-auction-platform.git
cd online-auction-platform
```

Nëse projekti është dorëzuar si ZIP, shpaketojeni dhe hapni terminalin në dosjen që përmban `package.json` dhe `docker-compose.yml`. Repository mund të kërkojë qasje të autorizuar; qasja publike nuk u verifikua gjatë këtij kontrolli.

### 5.2 Instalimi i varësive

Nga rrënja e projektit:

```powershell
npm.cmd ci
```

Kjo komandë instalon root workspace, dy paketat e përbashkëta, pesë shërbimet dhe frontend-in sipas `package-lock.json`. Nuk kërkohet instalim manual në secilën dosje. `npm ci` rikrijon `node_modules`; përdoreni gjatë instalimit, jo si komandë për nisjen e përditshme.

Pastaj krijoni konfigurimin **vetëm nëse `.env` nuk ekziston**:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Redaktoni `.env` sipas seksionit 6. Mos zëvendësoni konfigurimin ekzistues me shembullin gjatë një rinisjeje.

### 5.3 Çelësat JWT

Nga rrënja, vetëm për një instalim pa çelësa ekzistues:

```powershell
npm.cmd run gen-keys
```

Skripti krijon `secrets/jwt_private.pem` dhe `secrets/jwt_public.pem` për RSA 2048-bit. Nëse ekziston njëri prej tyre, skripti ndalon pa i mbishkruar. Mos përdorni `--force` gjatë instalimit normal, sepse zëvendësimi i çelësave zhvlerëson token-at ekzistues. Vetëm `auth-service` monton çelësin privat; shërbimet e tjera marrin publikun.

Në Linux, skripti e krijon çelësin privat me leje vetëm për pronarin, ndërsa container-i punon si `node`. Konfigurimi ekzistues CI përdor komandën e mëposhtme për çelësin demonstrues lokal:

```bash
chmod 644 secrets/jwt_private.pem
```

Kjo e bën skedarin të lexueshëm nga përdoruesit lokalë dhe vlen vetëm për mjedisin demonstrues me çelësa testimi. Shpërndarja e sigurt e sekreteve për një mjedis publik nuk është e zgjidhur nga ky konfigurim.

## 6. Konfigurimi i variablave të mjedisit

Burimi bazë është [`.env.example`](.env.example). `.env`, çelësat dhe certifikatat lokale nuk duhet të përfshihen në dorëzim apo në Git. Vlerat e mëposhtme janë konfigurime shembull ose placeholders, jo kredenciale reale.

Compose lexon `.env` në rrënjë dhe ua kalon shërbimeve variablat e deklaruara në `docker-compose.yml`. Node.js dhe Jest nuk e lexojnë vetvetiu atë skedar. Vite përdor `envDir: '..'` dhe lexon `VITE_*` nga `.env` në rrënjë.

### 6.1 PostgreSQL dhe testet

| Variabla               | Vlera shembull                                                  | Qëllimi                                                        |
| ---------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `POSTGRES_HOST`        | `postgres`                                                      | Emri DNS brenda rrjetit Docker; lokalisht përdorni `localhost` |
| `POSTGRES_PORT`        | `5432`                                                          | Porta brenda container-it                                      |
| `POSTGRES_HOST_PORT`   | `5433`                                                          | Porta e publikuar vetëm në localhost                           |
| `POSTGRES_USER`        | `auction`                                                       | Përdoruesi PostgreSQL                                          |
| `POSTGRES_PASSWORD`    | `<POSTGRES_PASSWORD>`                                           | Fjalëkalim i zgjedhur lokalisht                                |
| `AUTH_DB_NAME`         | `auth_db`                                                       | Baza e autentikimit                                            |
| `AUCTION_DB_NAME`      | `auction_db`                                                    | Baza e katalogut                                               |
| `BIDDING_DB_NAME`      | `bidding_db`                                                    | Baza e ofertave                                                |
| `PAYMENT_DB_NAME`      | `payment_db`                                                    | Baza e kuletave dhe shlyerjeve                                 |
| `NOTIFICATION_DB_NAME` | `notification_db`                                               | Baza e njoftimeve                                              |
| `TEST_DATABASE_URL`    | `postgres://auction:<ENCODED_PASSWORD>@localhost:5433/postgres` | Lidhja administrative për bazat e përkohshme të testeve        |

Fjalëkalimi dhe emri i përdoruesit në URL duhet të përputhen me konfigurimin PostgreSQL. Karakteret speciale në URL duhet të kodohen me percent-encoding. Në Compose, host-i dhe porta e shërbimeve janë të vendosura drejtpërdrejt në `postgres:5432`; ndryshimi vetëm i `.env` nuk e ndryshon këtë lidhje të brendshme.

### 6.2 Redis, RabbitMQ dhe variablat e përgjithshme

| Variabla                        | Vlera shembull                                    | Qëllimi                                                                                                   |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                      | `development`                                     | E dokumentuar në shembull; Dockerfile-t e backend-it vendosin `production`                                |
| `LOG_LEVEL`                     | `info`                                            | Niveli i Pino: `fatal`, `error`, `warn`, `info`, `debug`, `trace`                                         |
| `REDIS_URL`                     | `redis://redis:6379`                              | Lidhja nga bidding brenda Docker                                                                          |
| `REDIS_HOST_PORT`               | `6379`                                            | Porta lokale Redis                                                                                        |
| `STATE_CACHE_ENABLED`           | `true`                                            | Aktivizon cache të gjendjes; `false` përdoret për krahasimin e performancës, pa çaktivizuar Redis pub/sub |
| `STATE_CACHE_TTL_SECONDS`       | `30`                                              | Jetëgjatësia e cache të gjendjes                                                                          |
| `TEST_REDIS_URL`                | `redis://localhost:6379`                          | Aktivizon testet reale Redis; përdoret DB 15                                                              |
| `RABBITMQ_USER`                 | `auction`                                         | Përdoruesi i broker-it                                                                                    |
| `RABBITMQ_PASSWORD`             | `<RABBITMQ_PASSWORD>`                             | Fjalëkalim i zgjedhur lokalisht                                                                           |
| `RABBITMQ_URL`                  | `amqp://auction:<ENCODED_PASSWORD>@rabbitmq:5672` | URL e broker-it brenda Docker                                                                             |
| `EVENTS_EXCHANGE`               | `auction.events`                                  | Topic exchange                                                                                            |
| `RABBITMQ_HOST_PORT`            | `5672`                                            | Porta lokale AMQP                                                                                         |
| `RABBITMQ_MANAGEMENT_HOST_PORT` | `15672`                                           | Porta e ndërfaqes RabbitMQ                                                                                |
| `SMTP_HOST`, `SMTP_PORT`        | `mailhog`, `1025`                                 | Variabla të rezervuara; nuk ka shërbim SMTP aktiv në Compose                                              |

Ndryshimi i kredencialeve vetëm në `.env` nuk rikrijon përdoruesit që janë inicializuar tashmë në volume PostgreSQL/RabbitMQ.

### 6.3 JWT dhe shërbimet

| Variabla                    | Vlera shembull                 | Qëllimi                             |
| --------------------------- | ------------------------------ | ----------------------------------- |
| `JWT_PRIVATE_KEY_PATH`      | `/run/secrets/jwt_private.pem` | Skedari brenda auth container       |
| `JWT_PUBLIC_KEY_PATH`       | `/run/secrets/jwt_public.pem`  | Skedari publik brenda container-ave |
| `JWT_ISSUER`                | `auction-auth-service`         | Lëshuesi i pranuar nga verifikuesit |
| `JWT_AUDIENCE`              | `auction-platform`             | Audienca e token-it                 |
| `JWT_ACCESS_TTL_SECONDS`    | `900`                          | Jetëgjatësia e access token         |
| `JWT_REFRESH_TTL_SECONDS`   | `604800`                       | Jetëgjatësia e refresh token        |
| `LOGIN_MAX_FAILED_ATTEMPTS` | `5`                            | Prag për bllokim të login           |
| `LOGIN_LOCK_SECONDS`        | `300`                          | Kohëzgjatja e bllokimit             |
| `AUTH_SERVICE_PORT`         | `3001`                         | Porta e auth                        |
| `AUCTION_SERVICE_PORT`      | `3002`                         | Porta e auction                     |
| `BIDDING_SERVICE_PORT`      | `3003`                         | Porta e bidding                     |
| `PAYMENT_SERVICE_PORT`      | `3004`                         | Porta e payment                     |
| `NOTIFICATION_SERVICE_PORT` | `3005`                         | Porta e notification                |
| `PAYMENT_SERVICE_URL`       | `http://payment-service:3004`  | Kontrolli i brendshëm i fondeve     |
| `BIDDING_SERVICE_URL`       | `http://bidding-service:3003`  | Anulimi i brendshëm i ankandit      |
| `FUNDS_CHECK_TIMEOUT_MS`    | `2000`                         | Timeout i kontrollit të fondeve     |
| `BIDDING_CANCEL_TIMEOUT_MS` | `2000`                         | Timeout i anulimit                  |

Mbani portat e brendshme standarde: target-et Nginx dhe URL-të ndërmjet shërbimeve përdorin portat përkatëse. Ndryshimi i një porte kërkon përshtatje të koordinuar të konfigurimeve; nuk mjafton ndryshimi i një variabli të vetëm.

### 6.4 Rregullat e biznesit

| Variabla                  | Vlera shembull | Qëllimi                                          |
| ------------------------- | -------------- | ------------------------------------------------ |
| `SNIPE_WINDOW_SECONDS`    | `30`           | Dritarja para mbarimit ku oferta zgjat ankandin  |
| `SNIPE_EXTENSION_SECONDS` | `30`           | Zgjatja për çdo aktivizim                        |
| `MAX_EXTENSIONS`          | `10`           | Kufiri i zgjatjeve                               |
| `CLOSING_INTERVAL_MS`     | `1000`         | Intervali i closing worker                       |
| `CLOSING_BATCH_SIZE`      | `50`           | Ankande të përpunuara për grup                   |
| `PLATFORM_FEE_PERCENT`    | `5`            | Përqindja e platformës në shlyerje               |
| `CURRENCY`                | `EUR`          | Monedha e platformës; seeds aktuale përdorin EUR |

### 6.5 Gateway dhe frontend

| Variabla                 | Vlera shembull                                 | Qëllimi                          |
| ------------------------ | ---------------------------------------------- | -------------------------------- |
| `GATEWAY_HTTP_PORT`      | `8080`                                         | Porta HTTP me ridrejtim në HTTPS |
| `GATEWAY_HTTPS_PORT`     | `8443`                                         | Porta publike e API-së           |
| `GATEWAY_API_RATE`       | `20r/s`                                        | Kufiri i kërkesave API për IP    |
| `GATEWAY_API_BURST`      | `40`                                           | Burst i API-së                   |
| `GATEWAY_AUTH_RATE`      | `10r/m`                                        | Kufiri më i rreptë për auth      |
| `GATEWAY_AUTH_BURST`     | `5`                                            | Burst i auth                     |
| `GATEWAY_STREAMS_PER_IP` | `20`                                           | Lidhjet SSE për IP               |
| `BIDDING_REPLICAS`       | `2`                                            | Replikat e ofertimit             |
| `CORS_ALLOWED_ORIGINS`   | `http://localhost:5173,https://localhost:8443` | Origin-et e lejuara nga gateway  |
| `SWAGGER_UI_HOST_PORT`   | `8081`                                         | Porta opsionale Swagger UI       |
| `VITE_API_BASE_URL`      | `https://localhost:8443/api/v1`                | URL e API-së për browser         |

`VITE_*` ekspozohen në browser dhe nuk duhet të përmbajnë sekrete. Ndryshimi i `VITE_API_BASE_URL` kërkon rinisjen e Vite ose rindërtimin e frontend-it. Për Swagger “Try it out”, shtoni edhe `http://localhost:8081` në `CORS_ALLOWED_ORIGINS` dhe rikrijoni gateway.

### 6.6 Variabla ndihmëse jashtë `.env.example`

| Variabla              | Përdorimi                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NODE_EXTRA_CA_CERTS` | Path lokal për `gateway/certs/cert.pem`, që testet Node t'i besojnë certifikatës                              |
| `GATEWAY_URL`         | Override i URL-së HTTPS për testet E2E; parazgjedhje `https://localhost:8443`                                 |
| `GATEWAY_HTTP_URL`    | Override i URL-së HTTP për gateway smoke; parazgjedhje `http://localhost:8080`                                |
| `RABBITMQ_TEST_URL`   | Broker lokal testimi për suite-n reale RabbitMQ dhe disa E2E; përdorni `localhost`, jo `rabbitmq`, nga host-i |
| `PAYMENT_DB_URL`      | Override i lidhjes direkte te payment DB në testin wallet                                                     |
| `DOCKER_BIN`          | Override i ekzekutuesit Docker në testet e sigurisë                                                           |
| `DATABASE_DIR`        | Dosja SQL për `init-databases.sh`; në container është `/database`                                             |
| `RERUN_SEEDS`         | `1` aktivizon zbatimin e dytë të seed-eve gjatë inicializimit, si në CI                                       |

## 7. Konfigurimi i bazës së të dhënave

### 7.1 Inicializimi automatik me Compose

Nga rrënja, pas konfigurimit të `.env`:

```powershell
docker compose config --quiet
docker compose up -d --wait --wait-timeout 180 postgres redis rabbitmq
docker compose ps
```

`config --quiet` kontrollon konfigurimin pa shtypur sekretet e zëvendësuara. Në nisjen e parë me volume PostgreSQL bosh, entrypoint ekzekuton `database/init-databases.sh`. Skripti krijon nga një bazë për secilën dosje shërbimi dhe zbaton skedarët numerikë SQL sipas rendit alfabetik: skema, seed dhe skedarët `003_*`, kur ekzistojnë.

Nuk ka ORM apo komandë `npm run migrate`. Inicializimi kryhet nga SQL dhe skripti Bash. `npm.cmd run seed` rizbaton seed-et në bazat ekzistuese pa i fshirë ato; nuk kryen migrime skeme. Nuk nevojitet instalimi i `psql` në host për rrugën me Docker.

| Baza e parazgjedhur | Përmbajtja kryesore                                                |
| ------------------- | ------------------------------------------------------------------ |
| `auth_db`           | Përdoruesit, rolet, refresh tokens dhe login throttling            |
| `auction_db`        | Kategoritë, ankandet, URL-të e imazheve dhe ngjarjet e përpunuara  |
| `bidding_db`        | Gjendja lokale e ankandeve, ofertat, idempotency keys dhe ngjarjet |
| `payment_db`        | Kuletat, settlements dhe ledger entries                            |
| `notification_db`   | Njoftimet dhe gjendja e leximit                                    |

Seed-et përmbajnë administrator, shitës demonstrues, dy ofertues, kategori, ankande me gjendje të ndryshme, oferta, kuleta dhe njoftime. Identitetet demo përshkruhen në `database/auth/002_seed.sql`; fjalëkalimet nuk riprodhohen në këtë dokument. Përdorini vetëm për demonstrim lokal.

Kohët e ankandeve demo llogariten gjatë inicializimit. Me kalimin e ditëve ato përfundojnë; një restart nuk i bën sërish aktive. Seed-et përdorin `ON CONFLICT DO NOTHING`, por kjo nuk e bën të gjithë inicializuesin të sigurt për përsëritje: ai përmban `CREATE DATABASE` dhe skema me `CREATE TABLE`.

### 7.2 Kontrolli i lidhjes dhe skemave

Komandat më poshtë përdorin variablat e container-it, pa shkruar kredenciale në terminal:

```powershell
docker compose exec postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d postgres'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "SELECT datname FROM pg_database ORDER BY datname;"'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$AUTH_DB_NAME" -c "SELECT count(*) AS users FROM users;"'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$AUCTION_DB_NAME" -c "SELECT count(*) AS categories FROM categories;"'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$BIDDING_DB_NAME" -c "SELECT count(*) AS states FROM auction_state;"'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$PAYMENT_DB_NAME" -c "SELECT count(*) AS wallets FROM wallets;"'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$NOTIFICATION_DB_NAME" -c "SELECT count(*) AS notifications FROM notifications;"'
```

Rezultati i pritshëm është gatishmëri nga `pg_isready`, pesë bazat e konfiguruara dhe ekzekutim pa gabime i query-ve. Numrat ndryshojnë sipas përdorimit të aplikacionit; këto rezultate nuk u konfirmuan gjatë kontrollit aktual.

### 7.3 Volume ekzistuese dhe ndryshimet SQL

PostgreSQL ekzekuton inicializimin vetëm kur volume është bosh. Nëse përdorni një volume të krijuar para `003_login_throttling.sql` ose `003_catalog_indexes.sql`, nisja e re nuk i zbaton automatikisht këta skedarë. Kontrolloni skemën dhe historikun para aplikimit manual; repository nuk përmban një menaxher migrimesh me versionim. `start:stack` përfshin vetëm një përmirësim specifik për bazën e vjetër të njoftimeve kur tabela `notifications` mungon.

Mos përdorni `docker compose down -v` për ndalim të zakonshëm: ai fshin të dhënat PostgreSQL dhe RabbitMQ. Gjatë këtij verifikimi nuk u rivendos baza dhe nuk u ndryshuan të dhënat e aplikacionit.

## 8. Nisja dhe ekzekutimi i aplikacionit

### 8.1 Backend dhe infrastruktura

Nga rrënja, me `.env` dhe çelësat JWT gati:

```powershell
docker compose up -d --build --wait --wait-timeout 300
docker compose ps
```

Kjo ndërton pesë backend images dhe gateway, dhe nis PostgreSQL, Redis, RabbitMQ dhe shërbimet. Auth, auction, bidding, payment dhe notification presin që PostgreSQL dhe RabbitMQ të jenë healthy. Gateway mund të niset më herët; për një shërbim ende të paarritshëm ai mund të kthejë `503`.

Frontend-i, Swagger UI dhe Prometheus nuk nisen nga kjo komandë standarde. Redis ka healthcheck, por bidding nuk e ka deklaruar si kusht `depends_on`: kodi provon lidhjen në sfond. Pa Redis, leximi i gjendjes mund të bjerë te PostgreSQL, ndërsa përditësimet live ndërmjet replikave janë të kufizuara.

Për diagnostikim:

```powershell
docker compose logs --tail 80 auth-service auction-service bidding-service payment-service notification-service gateway
```

Shërbimet shkruajnë log-e JSON; kodi i nisjes përdor mesazhe si `auth-service listening` dhe `bidding-service listening`. Këto janë mesazhe të pritshme sipas kodit, jo dalje të vëzhguara në këtë verifikim. RabbitMQ topology deklarohet nga event bus gjatë nisjes; nuk kërkohet një komandë manuale shtesë për nisjen normale me Compose.

### 8.2 Frontend për zhvillim

Në një terminal tjetër, sërish nga rrënja:

```powershell
npm.cmd run dev -w frontend
```

Hapni `http://localhost:5173`. Vite është konfiguruar me `strictPort: true`: nëse porta është e zënë, nisja dështon dhe nuk kalon automatikisht në portën tjetër.

Për herë të parë hapni `https://localhost:8443/health` në shfletues dhe pranoni certifikatën lokale të vetënënshkruar, pastaj rifreskoni frontend-in. Certifikata gjenerohet nga gateway në `gateway/certs/`. Besimi duhet përsëritur kur certifikata ndryshon. Përdorni origin-in `localhost:5173` që përputhet me CORS; `127.0.0.1:5173` është origin tjetër.

### 8.3 Adresat dhe portat

| Komponenti                                        | Adresa / porta e parazgjedhur              | Shënim                                    |
| ------------------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Frontend                                          | `http://localhost:5173`                    | Proces Vite në host                       |
| API publike                                       | `https://localhost:8443/api/v1`            | E gjithë API kalon përmes gateway         |
| Gateway health                                    | `https://localhost:8443/health`            | Kontrollon vetëm Nginx                    |
| HTTP gateway                                      | `http://localhost:8080`                    | Ridrejton në HTTPS, përveç health         |
| PostgreSQL nga host-i                             | `localhost:5433`                           | Brenda Docker: `postgres:5432`            |
| Redis nga host-i                                  | `localhost:6379`                           | Brenda Docker: `redis:6379`               |
| RabbitMQ AMQP                                     | `localhost:5672`                           | Brenda Docker: `rabbitmq:5672`            |
| RabbitMQ Management                               | `http://localhost:15672`                   | Kredencialet lokale nga `.env`            |
| Swagger UI, opsional                              | `http://localhost:8081`                    | Aktivizohet me profilin `docs`            |
| Auth / auction / bidding / payment / notification | `3001` / `3002` / `3003` / `3004` / `3005` | Vetëm rrjeti Docker; pa host port mapping |

Portat e publikuara nga Compose lidhen vetëm në `127.0.0.1`.

### 8.4 Swagger UI

```powershell
docker compose --profile docs up -d swagger-ui
```

Hapni `http://localhost:8081`. Disponohen të pesë specifikimet: auth, auction, bidding, payment dhe notification. Për “Try it out” lejoni origin-in e Swagger në CORS dhe besoni certifikatën e gateway; pastaj zbatoni ndryshimin:

```powershell
docker compose up -d --force-recreate gateway
```

### 8.5 Build dhe kufijtë e përdorimit në prodhim

```powershell
npm.cmd run build
```

Root script ndërton fillimisht paketat e përbashkëta dhe pastaj workspaces. Backend-i prodhon `dist/server.js` për shërbim; frontend-i prodhon `frontend/dist/`. Dockerfile-t ndërtojnë backend-in dhe e nisin me `NODE_ENV=production` si përdorues `node`.

Për kontroll lokal të frontend-it të ndërtuar:

```powershell
npm.cmd run preview -w frontend -- --host localhost --port 4173 --strictPort
```

Shtoni `http://localhost:4173` në CORS nëse provoni API nga preview. Preview është vetëm për kontroll lokal të build-it. Repository nuk përmban shërbim Docker për publikimin e frontend-it, konfigurim të plotë për hostim publik, certifikatë publike TLS apo Kubernetes. Prandaj build-i i prodhimit nuk duhet barazuar me një shpërndarje të përfunduar në prodhim.

## 9. Verifikimi i funksionalitetit

**Kërkesat dhe përgjigjet e këtij seksioni janë procedurë verifikimi dhe rezultate të pritshme nga implementimi. Ato nuk paraqiten si përgjigje reale të marra gjatë këtij kontrolli.** Përdorni portat e ndryshuara nëse `.env` juaj ndryshon nga shembulli.

### 9.1 Gateway, lidhja e bazës dhe shërbimet

Nga rrënja, pasi certifikata të jetë gjeneruar:

```powershell
curl.exe --cacert gateway/certs/cert.pem -i https://localhost:8443/health
curl.exe -i http://localhost:8080/api/v1/auctions
curl.exe --cacert gateway/certs/cert.pem -i https://localhost:8443/api/v1/categories
curl.exe --cacert gateway/certs/cert.pem -i 'https://localhost:8443/api/v1/auctions?page=1&size=5'
```

Priten përkatësisht `200` me `{"status":"ok"}`, `301` me `Location` drejt HTTPS, dhe `200` për kategoritë e katalogun. Listat përdorin strukturën `{"data":[...],"page":1,"size":5,"total":...}` me vlera sipas kërkesës dhe përmbajtjes së bazës.

**Health i gateway nuk provon lidhjen e bazës.** Health i secilit mikroshërbim ekzekuton query në PostgreSQL, kthen `200 {"status":"ok"}` kur lidhja funksionon dhe `503` kur ajo dështon. Endpoint-et e shërbimeve nuk ekspozohen drejtpërdrejt nga gateway. Për t'i kontrolluar nga container-at:

```powershell
docker compose exec auth-service node -e "fetch('http://localhost:3001/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1))"
docker compose exec auction-service node -e "fetch('http://localhost:3002/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1))"
docker compose exec bidding-service node -e "fetch('http://localhost:3003/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1))"
docker compose exec payment-service node -e "fetch('http://localhost:3004/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1))"
docker compose exec notification-service node -e "fetch('http://localhost:3005/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1))"
docker compose exec redis redis-cli ping
docker compose exec rabbitmq rabbitmq-diagnostics -q ping
```

Redis duhet të përgjigjet `PONG`. Kontrollet `/health` nuk verifikojnë çdo varësi ose të gjithë ciklin e ngjarjeve; për këtë kërkohen testet E2E.

### 9.2 Regjistrimi dhe autentikimi

Shembujt përdorin `curl.exe` nga PowerShell dhe JSON nga stdin, për të shmangur problemet me thonjëzat. Vendosni fjalëkalimin tuaj lokal në placeholder dhe përdorni një email të ri për çdo regjistrim. Fjalëkalimi i ri duhet të ketë 8–128 karaktere.

```powershell
$registration = @{
    email = 'assessment.user@example.test'
    password = '<LOCAL_TEST_PASSWORD>'
    displayName = 'Assessment User'
} | ConvertTo-Json -Compress
$registration | curl.exe --cacert gateway/certs/cert.pem -i -H 'Content-Type: application/json' --data-binary '@-' https://localhost:8443/api/v1/auth/register
```

Pritet `201 Created`, me përdoruesin dhe rolin `BIDDER`, pa fjalëkalimin ose hash-in e tij. Email ekzistues jep konflikt `409`; input i pavlefshëm jep `400`. Regjistrimi nuk kthen token: bëni login veçmas.

```powershell
$loginBody = @{
    email = 'assessment.user@example.test'
    password = '<LOCAL_TEST_PASSWORD>'
} | ConvertTo-Json -Compress
$rawSession = $loginBody | curl.exe --cacert gateway/certs/cert.pem -sS --fail-with-body -H 'Content-Type: application/json' --data-binary '@-' https://localhost:8443/api/v1/auth/login
$session = $rawSession | ConvertFrom-Json
$token = $session.accessToken
curl.exe --cacert gateway/certs/cert.pem -i -H "Authorization: Bearer $token" https://localhost:8443/api/v1/users/me
```

Pritet login `200` me fushat `accessToken`, `refreshToken`, `tokenType: "Bearer"`, `expiresIn` dhe `user`. Mos publikoni përmbajtjen reale të token-ave në raport ose screenshots. `GET /users/me` me token të vlefshëm kthen `200`.

Kontrolli pa autorizim:

```powershell
curl.exe --cacert gateway/certs/cert.pem -i https://localhost:8443/api/v1/users/me
```

Pritet `401`. Struktura e gabimit sipas middleware është:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "details": [],
    "requestId": "<REQUEST_ID>"
  }
}
```

`requestId` është dinamik. Për gabimet e tjera ndryshojnë `code`, `message` dhe `details`. Kufiri i gateway mund të japë `429` nëse bëhen shumë kërkesa auth; pas pesë login-eve të gabuara radhazi llogaria bllokohet sipas konfigurimit.

Refresh dhe logout, pasi login të ketë përfunduar me sukses:

```powershell
$refreshBody = @{ refreshToken = $session.refreshToken } | ConvertTo-Json -Compress
$rawRefresh = $refreshBody | curl.exe --cacert gateway/certs/cert.pem -sS --fail-with-body -H 'Content-Type: application/json' --data-binary '@-' https://localhost:8443/api/v1/auth/refresh
$session = $rawRefresh | ConvertFrom-Json
$token = $session.accessToken
$logoutBody = @{ refreshToken = $session.refreshToken } | ConvertTo-Json -Compress
$logoutBody | curl.exe --cacert gateway/certs/cert.pem -i -H 'Content-Type: application/json' --data-binary '@-' https://localhost:8443/api/v1/auth/logout
```

Priten `200` dhe një çift i ri token-ash për refresh, pastaj `204` pa trup për logout. Refresh token rrotullohet dhe nuk ripërdoret. Pas logout bëni login të ri para shembujve të autentikuar më poshtë.

### 9.3 Kuleta, ofertat dhe njoftimet

Me një `$token` të vlefshëm nga login i ri:

```powershell
curl.exe --cacert gateway/certs/cert.pem -i -H "Authorization: Bearer $token" https://localhost:8443/api/v1/wallet/me
'{"amountCents":10000}' | curl.exe --cacert gateway/certs/cert.pem -i -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data-binary '@-' https://localhost:8443/api/v1/wallet/deposit
curl.exe --cacert gateway/certs/cert.pem -i -H "Authorization: Bearer $token" https://localhost:8443/api/v1/wallet/transactions
curl.exe --cacert gateway/certs/cert.pem -i -H "Authorization: Bearer $token" https://localhost:8443/api/v1/bids/me
curl.exe --cacert gateway/certs/cert.pem -i -H "Authorization: Bearer $token" https://localhost:8443/api/v1/notifications
curl.exe --cacert gateway/certs/cert.pem -i -H "Authorization: Bearer $token" https://localhost:8443/api/v1/notifications/unread-count
```

Këto kërkesa pritet të kthejnë `200`. Depozita është **simulim** dhe ndryshon gjendjen e kuletës; `10000` centë janë 100.00 EUR. Përgjigjja e depozitës ka fushat `wallet` dhe `transaction`. Kuleta përmban `id`, `userId`, `balanceCents`, `currency`, `createdAt`, `updatedAt`; numri i njoftimeve ka formën `{"unreadCount":0}`, me numër sipas të dhënave. Depozita e vetme lejon `amountCents` nga `1` deri në `1000000`.

Për një ankand që ekziston në `bidding_db`, zëvendësoni UUID-në me një ID nga katalogu. Në një bazë të sapoinicializuar mund të përdoret ankandi demonstrues më poshtë, por ai nuk mbetet aktiv përgjithmonë:

```powershell
$auctionId = '10000000-0000-4000-8000-000000000002'
curl.exe --cacert gateway/certs/cert.pem -i "https://localhost:8443/api/v1/auctions/$auctionId/state"
curl.exe --cacert gateway/certs/cert.pem -i "https://localhost:8443/api/v1/auctions/$auctionId/bids"
curl.exe --cacert gateway/certs/cert.pem -N --max-time 10 "https://localhost:8443/api/v1/auctions/$auctionId/stream"
```

Gjendja dhe historiku janë publikë. SSE duhet të përgjigjet me `text/event-stream`; skadimi i `--max-time 10` e mbyll qëllimisht demonstrimin dhe mund të japë exit code timeout në curl. DRAFT nuk ka domosdoshmërisht gjendje në bidding dhe mund të japë `404`.

Oferta kërkon `BIDDER`, ankand aktiv, fonde të mjaftueshme dhe shumë së paku sa `minimumNextBidCents` nga `/state`. Shembulli 2000 centë është i vlefshëm vetëm për ofertën e parë në ankandin demonstrues të paprekur:

```powershell
$idempotencyKey = [guid]::NewGuid().ToString()
'{"amountCents":2000}' | curl.exe --cacert gateway/certs/cert.pem -i -H "Authorization: Bearer $token" -H "Idempotency-Key: $idempotencyKey" -H 'Content-Type: application/json' --data-binary '@-' "https://localhost:8443/api/v1/auctions/$auctionId/bids"
```

Pritet `201` me `bid` dhe `auction`; `409` është rezultat i mundshëm i saktë për fonde të pamjaftueshme, ofertë të ulët ose ankand të mbyllur. Shitësi nuk mund të ofertojë në ankandin e vet (`403`). `Idempotency-Key` është opsional në implementim; përdorimi i së njëjtës vlerë dhe të njëjtit payload mundëson riprovimin pa një ofertë të dytë.

### 9.4 Endpoint-e të tjera të implementuara

Të gjitha rrugët publike më poshtë kanë prefiksin `/api/v1`.

| Operacioni                    | Endpoint                                                          | Autorizimi / rezultati normal                     |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| Profili                       | `PATCH /users/me` me `displayName`                                | Përdorues i autentikuar; `200`                    |
| Krijimi i ankandit            | `POST /auctions`                                                  | `SELLER`; `201`, fillimisht `DRAFT`               |
| Ankandet e shitësit           | `GET /auctions/mine`                                              | `SELLER`; `200`                                   |
| Ndryshimi / fshirja e draftit | `PATCH /auctions/:id`, `DELETE /auctions/:id`                     | Pronari `SELLER`; `200` / `204`, sipas gjendjes   |
| Publikimi                     | `POST /auctions/:id/publish`                                      | Pronari `SELLER`; `200`                           |
| Anulimi                       | `POST /auctions/:id/cancel`                                       | Pronari ose `ADMIN`, sipas rregullave; `200`      |
| Krijimi i kategorisë          | `POST /categories`                                                | `ADMIN`; `201`                                    |
| Përdoruesit dhe rolet         | `GET /users`, `PATCH /users/:id/status`, `PATCH /users/:id/roles` | `ADMIN`; `200`                                    |
| Shlyerjet                     | `GET /payments`                                                   | `ADMIN`; `200`                                    |
| Leximi i njoftimit            | `PATCH /notifications/:id/read`                                   | Vetëm njoftimi i përdoruesit; `200`               |
| Leximi i të gjitha njoftimeve | `POST /notifications/read-all`                                    | Përdorues i autentikuar; `200`, `{"updated":...}` |

Payload-et dhe kushtet për auth, auction dhe payment përshkruhen në [OpenAPI](docs/api/). Për bidding dhe notification ekzistojnë gjithashtu `docs/api/bidding.yaml` dhe `docs/api/notification.yaml`, të përfshira në Swagger UI. Endpoint-et `/internal/funds-check` dhe `/internal/auctions/:id/cancel` janë vetëm për komunikim në rrjetin Docker dhe bllokohen nga gateway.

## 10. Ekzekutimi i testeve

### 10.1 Kontrollet statike dhe build

Nga rrënja:

```powershell
npm.cmd ls --depth=0
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run format:check
```

Këto nuk kërkojnë bazë aktive. `typecheck` ndërton automatikisht shared packages përmes `pretypecheck`. `format:check` vetëm kontrollon formatimin; mos përdorni `format` ose `lint:fix` për një verifikim që duhet të ruajë kodin të pandryshuar.

### 10.2 Jest: unit dhe integrimi

Testet e shërbimeve krijojnë dhe fshijnë baza të përkohshme në PostgreSQL. Përdorni vetëm server lokal testimi ku përdoruesi ka të drejtën `CREATE DATABASE`. Testet Redis përdorin DB 15; mos e përdorni atë DB për të dhëna me vlerë.

Pasi infrastruktura e seksionit 7 të jetë aktive, eksportoni në proces vlerat e testimit nga `.env` pa i shfaqur. Komanda përdor loader-in e Node.js 24 dhe nuk ngarkon `.env` si kod PowerShell:

```powershell
node --env-file=.env -e "const {spawnSync}=require('node:child_process'); const r=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['test'],{stdio:'inherit',shell:process.platform==='win32'}); process.exit(r.status ?? 1)"
```

Nëse `TEST_DATABASE_URL` dhe `TEST_REDIS_URL` janë eksportuar tashmë në terminal, përdorni drejtpërdrejt:

```powershell
npm.cmd test
```

`pretest` ndërton shared packages; `test` ekzekuton Jest në workspaces që kanë këtë script. Frontend-i ka script `test` me Node test runner për helper-at e ndërfaqes. `.env` nuk lexohet automatikisht nga `npm test`; pa eksportim, helpers përdorin URL-në lokale të parazgjedhur të testimit, e cila mund të mos përputhet me fjalëkalimin tuaj.

Për testet unit të paketave të përbashkëta:

```powershell
npm.cmd run build:shared
npm.cmd test -w @auction/shared-auth -- --runInBand
npm.cmd test -w @auction/shared-common -- --runInBand
```

Suite reale RabbitMQ në shared-common aktivizohet vetëm kur `RABBITMQ_TEST_URL` është vendosur. Ajo pastron queues të shërbimeve: përdorni broker të veçuar për testim, jo broker me mesazhe që duhet të ruhen. Testet reale Redis anashkalohen kur `TEST_REDIS_URL` nuk është eksportuar. Një rezultat me teste të anashkaluara nuk provon integrimin përkatës.

### 10.3 Testet E2E dhe të sigurisë

Kërkojnë stack-un e plotë aktiv, çelësat dhe të dhënat demo. Nga rrënja:

```powershell
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path gateway/certs/cert.pem).Path
npm.cmd run test:gateway
npm.cmd run test:security
npm.cmd run test:events
npm.cmd run test:wallet
npm.cmd run test:settlement
npm.cmd run test:lifecycle
npm.cmd run test:load-balancing
```

Ekzekutojini një nga një. Këto suite krijojnë ose ndryshojnë të dhëna demonstrimi; disa publikojnë ngjarje sintetike. `test:security` përdor edhe Docker CLI, ndërsa `test:load-balancing` kërkon dy replika bidding dhe Redis për përditësimet ndërmjet tyre. `test:lifecycle` pret mbylljen reale të ankandeve dhe mund të zgjasë disa minuta. Testi i integruar lifecycle përfshin edhe kontrolle të njoftimeve.

Për ambiente me porta ose kredenciale ndryshe, eksportoni `GATEWAY_URL`, `GATEWAY_HTTP_URL`, `RABBITMQ_TEST_URL` dhe `PAYMENT_DB_URL`, sipas suite-s. URL-të nga host-i përdorin `localhost` dhe portat e publikuara. Disa teste përdorin parazgjedhjet e seed-eve të repository; kontrolloni përputhjen para ekzekutimit.

### 10.4 Rezultatet e verifikimit fillestar, para integrimit

| Kontrolli                                | Rezultati i vëzhguar më 09.11.2026                                                                                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --version`, `npm.cmd --version`    | `v24.15.0`, `11.12.1`                                                                                                                                                                                                                        |
| `npm.cmd ls --depth=0`                   | Përfundoi me exit code `0`; varësitë aktuale të instaluara u identifikuan                                                                                                                                                                    |
| `npm.cmd run lint`                       | Kaloi, exit code `0`                                                                                                                                                                                                                         |
| `npm.cmd run typecheck`                  | Kaloi për të gjitha workspaces, exit code `0`                                                                                                                                                                                                |
| `npm.cmd run build`                      | Kaloi, exit code `0`; Vite raportoi një JS chunk rreth 939 kB, mbi pragun paralajmërues 500 kB                                                                                                                                               |
| Nisja Vite                               | `npm.cmd run dev -w frontend -- --host 127.0.0.1` u nis; kërkesa lokale ktheu HTTP `200` dhe HTML e frontend-it; procesi u ndal pas kontrollit                                                                                               |
| Shared auth Jest                         | 4 suites dhe 48 teste kaluan                                                                                                                                                                                                                 |
| Shared common Jest                       | 5 suites dhe 90 teste kaluan; 1 suite me 4 teste RabbitMQ u anashkalua                                                                                                                                                                       |
| Testet e integrimit                      | U provuan përmes `npm.cmd test -- --runInBand`; flag-u nuk u përcoll siç duhet te Jest nga script-i rrënjë. Auction raportoi 7 suites të dështuara / 2 të kaluara dhe auth 4 të dështuara / 3 të kaluara, me timeout gjatë përgatitjes së DB |
| Përfundimi i suite-s së plotë            | U ndërpre pasi timeout-et e përsëritura e bënë të qartë që integrimi nuk mund të verifikohej; nuk ka rezultat përfundimtar të plotë për bidding, notification dhe payment                                                                    |
| PostgreSQL me konfigurimin aktual `.env` | Provat në pesë bazat përfunduan me timeout; edhe prova e kufizuar jashtë sandbox-it për auth nuk konfirmoi lidhjen                                                                                                                           |
| HTTPS gateway dhe autentikimi real       | Kërkesat drejt gateway përfunduan me timeout; login dhe përgjigjet e API-së nuk u konfirmuan                                                                                                                                                 |
| Docker / Compose                         | Komanda `docker` nuk u gjet në terminal; `config`, build i images, health dhe nisja nga zero nuk u verifikuan                                                                                                                                |
| `npm ci` në instalim të pastër           | Nuk u ekzekutua; u përdorën varësitë ekzistuese pa rikrijuar `node_modules`                                                                                                                                                                  |
| E2E / siguria / performanca              | E2E nuk u ekzekutuan deri në fund në mungesë të backend-it të arritshëm; k6 nuk u ekzekutua në kontrollin fillestar; skriptet dhe matjet e integruara gjenden në `tests/performance/`                                                        |

Timeout-et e integrimit nuk provojnë vetvetiu gabim të logjikës së biznesit. U panë edhe gabime pasuese teardown kur konteksti i testit nuk ishte krijuar. Këto rezultate kërkojnë riprovim me PostgreSQL dhe backend të arritshëm, jo deklarim se testet kalojnë. Rezultatet më të reja regjistrohen në `docs/test-report.md`; `docs/test-evidence/` ruan evidencat e mëparshme. Raporti i integruar deklaron kalim në mjedisin e vet. Tabela më lart ruan kufijtë e kontrollit fillestar dhe nuk përfaqëson një riekzekutim të versionit aktual.

## 11. Problemet e mundshme dhe zgjidhjet

| Problemi                                          | Shkaku i mundshëm                                                           | Veprimi i rekomanduar                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.ps1` bllokohet nga PowerShell                | Execution Policy                                                            | Përdorni `npm.cmd`; nuk nevojitet ndryshim global i policy                                                                                                 |
| `docker` nuk njihet                               | CLI mungon ose nuk është në PATH                                            | Instaloni/aktivizoni Docker dhe rihapni terminalin; kontrolloni `docker info`                                                                              |
| Docker daemon nuk përgjigjet                      | Docker Desktop/Engine i ndalur                                              | Niseni dhe prisni gatishmërinë për Linux containers                                                                                                        |
| `npm ci` dështon                                  | Node/npm jashtë versionit, lockfile jo në përputhje, registry i paarritshëm | Përdorni Node 24 dhe lockfile-in e dorëzuar; kontrolloni lidhjen. Mos e fshini lockfile-in si zgjidhje automatike                                          |
| Mungojnë shared modules ose `dist`                | Paketat e përbashkëta nuk janë ndërtuar                                     | `npm.cmd run build:shared` ose `npm.cmd run build`                                                                                                         |
| Compose raporton variabël të detyrueshme          | `.env` mungon ose është i paplotë                                           | Kopjoni modelin vetëm për instalim të ri dhe plotësoni kredencialet; përdorni `config --quiet`                                                             |
| Gabim çelësi JWT / permission denied              | Çelësa të pagjeneruar ose të palexueshëm nga `node` në container            | Kontrolloni `secrets/`, mount-et dhe lejet; mos rigjeneroni me forcë çelësa të një sistemi ekzistues                                                       |
| Browser shfaq “Could not reach the server”        | Certifikata lokale nuk është besuar, gateway i paarritshëm ose CORS         | Hapni `/health` me HTTPS, besoni certifikatën dhe kontrolloni origin-in e saktë                                                                            |
| API jep `503`                                     | Shërbimi ende s'është nisur ose varësi e paarritshme                        | `docker compose ps`, log-et dhe health i shërbimit; gateway health vetëm nuk mjafton                                                                       |
| DB/testet japin timeout ose authentication failed | Host/portë/fjalëkalim i gabuar ose server joaktiv                           | Kontrolloni PostgreSQL dhe `TEST_DATABASE_URL`; testi nga host-i nuk përdor DNS-në `postgres`                                                              |
| Tabelë/kolonë mungon në volume të vjetër          | SQL-të e reja nuk zbatohen automatikisht                                    | Kontrolloni skedarët `003_*` dhe skemën; përcaktoni migrimin pa fshirë të dhënat                                                                           |
| Porta është e zënë                                | Konflikt lokal                                                              | Identifikoni procesin me `Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue`; për portat Docker përshtatni host port dhe URL-të përkatëse |
| `401`                                             | Token i munguar/skaduar, issuer/audience ose çelësa jo në përputhje         | Bëni login të ri; verifikoni konfigurimin e përbashkët JWT                                                                                                 |
| `403`                                             | Rol i gabuar ose mungon pronësia                                            | Përdorni llogarinë përkatëse; regjistrimi nuk jep automatikisht `SELLER`                                                                                   |
| `429` ose login bllokohet                         | Rate limit i IP-së ose dështime të përsëritura të login                     | Prisni intervalin e lejuar dhe shmangni tentativa të shpejta; mos çaktivizoni kontrollet për demonstrim                                                    |
| Oferta jep `409`                                  | Shumë e ulët, ankand joaktiv, përdoruesi është më i larti ose s'ka fonde    | Kontrolloni `/state`, rolin, kohën dhe kuletën                                                                                                             |
| Përditësimet mes replikave mungojnë               | Redis/pub-sub i paarritshëm                                                 | Kontrolloni Redis dhe log-et bidding; leximi me fallback nuk provon se SSE ndërmjet replikave punon                                                        |
| Swagger nuk lejon “Try it out”                    | Origin jo në CORS ose certifikatë e pabesuar                                | Lejoni `http://localhost:8081`, rikrijoni gateway dhe besoni certifikatën                                                                                  |
| Build kalon, por frontend nuk gjen API            | `VITE_API_BASE_URL` mungon ose është i gabuar                               | Vendoseni në `.env` rrënjë dhe rinisni/rindërtoni frontend-in                                                                                              |

## 12. Ndalimi dhe rinisja e aplikacionit

Për Vite ose preview shtypni `Ctrl+C` në terminalin ku po ekzekutohet.

Për ndalim të përkohshëm të stack-ut duke ruajtur container-at dhe volume-t:

```powershell
docker compose stop
```

Për rinisje të container-ave ekzistues:

```powershell
docker compose start
docker compose ps
```

Për ndalim dhe largim të container-ave dhe rrjetit të krijuar nga Compose, duke ruajtur volume-t e emërtuara:

```powershell
docker compose --profile docs down
```

Për nisje të re pas `down`:

```powershell
docker compose up -d --wait --wait-timeout 300
npm.cmd run dev -w frontend
```

Nëse keni ndryshuar kodin, shtoni `--build` te `up`. Nëse keni ndryshuar variablat e backend-it në `.env`, përdorni `docker compose up -d --force-recreate` që container-at t'i marrin; `restart` nuk ua ndryshon mjedisin. Pas ndryshimit të `VITE_*`, rinisni Vite. Skriptet `server.ts` trajtojnë `SIGTERM`/`SIGINT` dhe përpiqen të mbyllin lidhjet dhe punët në progres.

## 13. Përfundim

Rruga e riprodhimit është: instalimi i Node.js 24 dhe Docker Compose, `npm ci`, përgatitja e `.env`, gjenerimi i çelësave JWT, nisja e Compose, kontrolli i inicializimit SQL dhe nisja e frontend-it me Vite. Vlerësuesi duhet të kontrollojë veçmas gateway, health të çdo mikroshërbimi, query-t në baza dhe kërkesat e autentikuara përpara ekzekutimit të testeve E2E.

Repository përmban implementim të gjerë të backend-it dhe pjesën kryesore të frontend-it, por nuk duhet konsideruar i përfunduar në të gjitha fushat. Kontrollet statike dhe build-i kaluan në verifikimin fillestar; raportet e integruara më pas dokumentojnë verifikim operacional në mjedisin e tyre. Gjatë zgjidhjes së konfliktit u kontrollua përputhja me skedarët aktualë, pa riekzekutuar stack-un. Gjatë përgatitjes së dokumentacionit nuk u ndryshua kodi apo konfigurimi i aplikacionit.

## 14. Çështjet e mbetura për përfundim

### 14.1 Çështje të hapura dhe kontrolli përfundimtar

1. **Performanca e ofertimit:** raporti i integruar mat p95 **1388.98 ms**, mbi objektivin **500 ms**. Objektivi mbetet i papërmbushur. Matja e përbashkët catalog/state nuk certifikon veçmas percentilin e katalogut; shihni [raportin](docs/performance-report.md).
2. **Kubernetes dhe CI/CD:** materialet zyrtare kërkojnë Kubernetes dhe pipeline të avancuar CI/CD. Ekziston GitHub Actions CI, por jo manifests Kubernetes ose pipeline shpërndarjeje. Duhet realizim ose sqarim i dokumentuar me mësimdhënësin.
3. **Riprodhimi në kompjuterin e dorëzimit:** konfirmoni versionet Docker/Compose, instalimin e pastër, healthcheck-et dhe testet. Rezultatet fillestare të këtij README dhe raportet e integruara kanë kontekste të ndryshme; mos i paraqitni si një ekzekutim të vetëm.
4. **Mbrojtja dhe miratimi njerëzor:** finalizoni provën e demonstrimit, kontributet dhe peer review. Automatizimi nuk provon se këta hapa njerëzorë janë kryer.
5. **Paketimi:** pasi ndryshimet të kontrollohen dhe të bëhet commit, përdorni `npm.cmd run package`. Skripti kërkon working tree të pastër dhe prodhon `dist/online-auction-platform.zip` nga HEAD; refuzon skedarë sekretë ose të gjeneruar të ndjekur nga Git. Arkivi ka dosjen rrënjë `online-auction-platform/`; pas shpaketimit përdorni `npm ci` dhe `npm run start:stack`. Skripti nuk kryen dorëzimin.

Skriptet operative tashmë ekzistojnë: `npm.cmd run seed` rizbaton seed-et, `npm.cmd run demo` ekzekuton lifecycle dhe `npm.cmd run reset-db -- --confirm` **fshin volume-t lokale të databazës dhe broker-it** për t'i rikrijuar. Reset përdoret vetëm kur synohet humbja e të dhënave; nuk u ekzekutua gjatë zgjidhjes së konfliktit. Bash wrappers opsionalë kërkojnë Git Bash në Windows; komandat npm punojnë drejtpërdrejt në PowerShell.

Frontend-i live, ofertat personale, njoftimet, OpenAPI për pesë shërbimet, Prometheus, k6, Bruno dhe raportet janë integruar dhe nuk listohen më si funksione që mungojnë. Për matje të reja ekziston `npm.cmd run perf`; ai ndryshon fixtures dhe konfigurime përkohësisht dhe përdoret vetëm në mjedis lokal demonstrimi sipas raportit.

### 14.2 Kufizime ekzistuese që duhen deklaruar

- **Fondet kontrollohen, por nuk rezervohen në ofertim.** Përdoruesi mund të bëjë angazhime në disa ankande që tejkalojnë bilancin; shlyerja mund të përfundojë me `payment.failed`.
- **Mungon transactional outbox.** Në disa rrjedha, dështimi i publikimit pas `COMMIT` regjistrohet në log, por ngjarja mund të humbasë. Retry i consumer-it nuk rikuperon një ngjarje që nuk u publikua.
- **Revokimi i access token nuk është i menjëhershëm.** Token-i i një përdoruesi të bllokuar mund të mbetet i vlefshëm deri në skadim, deri në 15 minuta me konfigurimin standard.
- **TLS është lokal dhe i vetënënshkruar.** Nuk ka konfigurim të përfunduar për certifikata publike dhe hostim publik.
- **Frontend ruan refresh token në `sessionStorage`.** Dokumentacioni ekzistues i frontend-it njeh ekspozimin e mundshëm ndaj XSS; konfigurimi i CSP për faqen e hostuar nuk është përfunduar.
- **SQL-të nuk kanë menaxher migrimesh.** Inicializimi i një volume të ri dhe përditësimi i një volume ekzistues janë procese të ndryshme.
- **Bundle i frontend-it është i madh.** Build-i kalon, por paralajmërimi për chunk mbi 500 kB mbetet për vlerësim; nuk është dështim i kompilimit.

Pagesat reale, OAuth, upload i imazheve, email/MailHog, watchlist, Grafana dhe faqet admin në frontend janë zgjerime jashtë fushëveprimit aktual të deklaruar në `docs/requirements.md`. Mungesa e tyre nuk duhet ngatërruar me mosfunksionimin e API-ve ekzistuese, as të paraqiten si të implementuara.

### 14.3 Informacioni që ende duhet konfirmuar

Për mbylljen e dokumentimit nevojiten: konfirmimi i riprodhimit dhe versioneve Docker/Compose në kompjuterin e dorëzimit, vendimi për Kubernetes/CI/CD, vlerësimi i kufizimeve të performancës dhe miratimi përfundimtar nga studentët. Nuk nevojitet dërgimi i fjalëkalimeve, token-ave ose çelësave privatë për këto konfirmime.

Planet në `ROADMAP.md` dhe `TASKS.md` përdorin afate të brendshme në nëntor 2026; materialet zyrtare të ofruara shënojnë afatin e dorëzimit më **08.01.2027**. Për afatin dhe mënyrën e dorëzimit ndiqni njoftimin zyrtar të lëndës/Moodle.
