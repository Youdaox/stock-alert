# stock-alert

TypeScript stock-monitoring worker scaffold with strict typing, stubbed adapters, and event pipeline primitives.

## Stack

- Node.js 20+
- TypeScript (strict)
- pnpm
- Drizzle ORM + Postgres
- node-cron
- undici
- zod
- pino
- vitest

## Quick start

1. Install dependencies:
   - `pnpm install`
2. Copy env file:
   - `cp .env.example .env`
3. Start local Postgres:
   - `docker compose up -d`
4. Run tests:
   - `pnpm test`
5. Run dev worker:
   - `pnpm dev`

## Windows-friendly scripts

All scripts in `package.json` are shell-agnostic and work in PowerShell/CMD with pnpm.

## Project layout

```text
src/
  adapters/
    types.ts
    shopify.ts
    index.ts
  db/
    schema.ts
    migrate.ts
  core/
    poller.ts
    differ.ts
    dedupe.ts
    http.ts
  notify/
    discord.ts
    queue.ts
  config.ts
  index.ts
```

## Notes

- Adapter and migration logic are intentionally stubbed with TODOs.
- `differ` is pure (`prev`, `next`) => `Event[]` and covered by tests.
- Poller includes a partial-failure guard that skips writes when a source returns fewer than 50% of previous snapshot count.
- Outbound network calls should use `requestWithPolicy` for delay, User-Agent, and exponential backoff behavior.
- SIGTERM/SIGINT handlers are wired for graceful shutdown.
