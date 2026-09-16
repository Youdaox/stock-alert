# stock-alert

Tracks Pokémon TCG sealed product stock across New Zealand stores, shows it on a local website, and posts restocks to Discord.

Currently tracked:

| Store | How it is read |
| --- | --- |
| The Game Tree, Card Masters, Booster Games | Shopify `/products.json` collections |
| Paper Plus | Listing pages parsed as HTML (browser user agent; it refuses bots) |
| The Warehouse | Category pages fetched through curl (Cloudflare rejects undici); "Find in-store" means not orderable online |

Toyworld was checked and disabled: it sells no Pokémon TCG online. Kmart NZ and Farmers are not tracked yet — both sit behind bot protection; see `test/fixtures/kmart-nz/` for the captured Kmart API shapes.

## Stack

- Node.js 20+ and TypeScript (strict)
- pnpm
- Postgres with Drizzle ORM
- Fastify for the website and JSON API
- node-cron, undici, zod, pino, vitest

## Quick start

1. Install dependencies: `pnpm install`
2. Create `.env` from `.env.example` and set `DATABASE_URL` (and `DISCORD_WEBHOOK_URL` for alerts).
3. Have Postgres running with an empty `stock_alert` database. Either use a local Postgres install (`createdb stock_alert`) or `docker compose up -d`.
4. Create the tables: `pnpm db:migrate`
5. Add the stores: `pnpm db:seed`
6. Start the tracker and website: `pnpm dev`, then open http://127.0.0.1:3100

The first check of each store records a baseline without sending alerts. After that, new listings, restocks and price drops go to Discord and the Activity tab.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Runs the tracker and website from source |
| `pnpm build` / `pnpm start` | Compiles to `dist/` and runs the compiled build |
| `pnpm test` | Runs the unit tests |
| `pnpm typecheck` | Type-checks without emitting |
| `pnpm db:generate` | Generates a migration after editing `src/db/schema.ts` |
| `pnpm db:migrate` | Applies migrations |
| `pnpm db:seed` | Inserts or updates the tracked stores |

## Adding a Shopify store

Add an entry to `src/db/seed.ts` with the store's base URL and the handles of its Pokémon collections (find them at `https://<store>/collections.json`), then run `pnpm db:seed`. Set `requireKeyword: true` if a collection mixes Pokémon with other products.

## How it works

```text
src/
  adapters/   store integrations (Shopify) returning products, locations and stock observations
  core/
    catalog.ts     sealed-product filter, category and language detection
    differ.ts      pure change detection (new listing, restock, sold out, price drop)
    record-run.ts  saves a check and queues alerts in one transaction
    poller.ts      schedules checks, guards against partial results
    http.ts        request delay, timeout, retries with backoff and Retry-After
  notify/     Discord formatting and the outbox dispatcher
  web/        Fastify API
  db/         Drizzle schema, migrations runner, seed
public/       website (HTML, CSS, JS)
```

- A product missing from a check is not treated as sold out.
- Checks that return under half the usual number of products are not saved.
- Alerts are written to a `notifications` table first and sent from there, so they survive restarts.
- Restock alerts for the same product are limited to one per `RESTOCK_ALERT_COOLDOWN_HOURS`.
