# Contributing

## Branches

- `main` is protected. Nobody pushes to it directly.
- One branch and one PR per task: `feat/<task-id>-<slug>`, e.g. `feat/A-11-auction-crud`.
  Use `fix/`, `docs/`, `test/` or `chore/` for work that is not a feature.
- The **other** member reviews and approves every PR.

## Commits

Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). Keep commits small.
Commits use your own Git identity. Never list an AI tool as author or co-author, and do not add
AI trailers. Record AI-assisted work in `docs/ai-usage.md` instead (required by the course).

## Before opening a PR

```bash
npm run lint
npm run format:check
npm test
npm run build
```

## Branch protection (set once in GitHub)

Settings → Branches → Add rule for `main`:

- Require a pull request before merging, with 1 approval
- Require status checks to pass: select "Lint, typecheck, build and test" (from `.github/workflows/ci.yml`)
- Do not allow force pushes or deletions

## Line endings (Windows)

`.gitattributes` forces LF so shell and SQL scripts work inside Linux containers.
If a file was committed with CRLF, run `git add --renormalize .` and commit the result.
