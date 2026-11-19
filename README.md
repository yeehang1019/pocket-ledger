# 口袋账本

Private, authenticated personal ledger with income, expense, refund entries and recurring rules. Chinese UI; MYR default plus SGD/USD/CNY/EUR/GBP/JPY/THB/IDR/HKD/TWD/AUD. No conversion between currencies. Dates use Asia/Kuala_Lumpur.

## Architecture

Browser PWA → same-origin `/api/ledger` → server-authenticated owner identity → D1 prepared statements. Sites owner-private access is retained. Identity must come from the trusted platform dispatcher, never a client body field. The API requires authentication for every operation and checks Origin on writes. Private responses use no-store; service worker never caches financial data.

Three tables: transactions, recurrence rules, and per-period occurrences. Amounts use integer minor units. Recurring unique keys prevent duplicate posting. Deleted recurring transactions remain as tombstones to prevent regeneration. Variable bills require confirmation; fixed bills post with their due date. Confirmed variable bills use confirmation date. Refunds reduce expenses in their recorded category and month; reference the original transaction in the note (no enforced linked-refund constraint yet).

## Appearance system

Six visual identities are implemented with CSS design tokens: Purple Dream, Ocean Blue, Monochrome, Warm Journey, Emerald Nature and Crimson. Each has a separate light and dark palette, gradient, accents, tint, border, shadow and on-primary color. The user may choose light, dark or system mode. Appearance is a device-local preference in `localStorage`; financial data remains server-side and is unaffected by theme changes. Warm Journey light is the SSR fallback before the saved preference is applied.

## Current delivery limits

- No background scheduler or direct Web Push connection is configured. Reconciliation runs on app opening, refocus, visible-page minute ticks, or manual sync. This is not guaranteed execution while the app is closed.
- Calendar ICS is an optional standalone copy, not synchronized push. Imports require the phone calendar and notification permission. Pause/end changes do not modify imported events.
- Actual iOS/Android installation, live sign-in, cross-device sync and notifications require on-device acceptance tests. Preview QA is desktop and unauthenticated.
- WebMCP registration is feature-detected. Preview browser had no modelContext; its end-to-end test was unavailable.
- Reads cap at 10,000 transactions and display a truncation warning; export uses the loaded set. 100 non-ended recurring rules maximum. No restore/import UI, custom categories, FX conversion or banking integration.
- A resumed rule skips paused periods. Ended rules cannot resume. Rule edits use ending and recreating to preserve history. No background concurrent execution is configured; adding it requires transactional race testing for pause/confirm/skip boundaries.

## Validation

`node tests/ledger-api.test.mjs` tests the real route logic against an in-memory SQLite adapter: auth rejection, cross-owner isolation, Origin rejection, precise amount validation, idempotent transactions/recurring sync, deletion tombstones, variable amount confirmation and terminal recurrence status. The adapter is test-only and never used by production.

`node node_modules/typescript/bin/tsc --noEmit`

`node node_modules/drizzle-kit/bin.cjs generate` after schema changes. Inspect migrations before publishing; never modify applied migrations. Production migrations are owned by Sites.

Follow configured project scripts for building and hosting. Never commit secrets or real user records. Database backups and restoration are platform operations; no app-managed backup guarantee is claimed.
