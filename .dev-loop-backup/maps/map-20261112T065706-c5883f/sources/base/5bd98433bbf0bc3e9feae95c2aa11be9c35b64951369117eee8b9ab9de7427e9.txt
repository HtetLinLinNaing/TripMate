# TripMate implementation and local verification

Implements all three workflows in the confirmed `.dev-loop/plans/tripmate-mvp/plan-preview.json`, revision 2, including the design-alignment decisions approved in chat. The application keeps trip setup, immutable ledger storage and accounting projections separate. The UI uses HeroUI/Tailwind, locally bundled Iconify icons, Supabase anonymous identity and SSR cookies. Protected Next.js API handlers invoke database command functions under the caller's identity, never a service-role key.

## Supabase setup

1. Use a dedicated Supabase project. Enable anonymous sign-ins in Authentication settings; configure provider-side rate limiting and CAPTCHA/abuse protection appropriate to deployment. Browser data/session loss loses access to anonymous membership; account recovery is outside this MVP.
2. Apply `supabase/migrations/202611100001_tripmate.sql` using the project's SQL editor or your normal migration pipeline. It creates the trip tables, command functions, access policies and realtime publication entries. This migration has **not** been applied to your hosted project by this task.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Do not put database passwords or secret/service-role keys in public variables. Both existing configuration names are supported.
4. Run `npm install`, then `npm run dev`. Deploy the same application over HTTPS. Verify two separate browser sessions can create/join a trip and receive realtime membership and ledger updates.

Invitations are high-entropy bearer tokens and are never exposed through public table reads. Their expiry is nullable; no new default expiry policy has been invented. Revoked/expired invitations reject new members. Existing members use their own membership rather than an invitation to regain access. New contributions and expenses are immutable through the public API and table permissions. Expense/allocation commits are transactional; retry identities prevent duplicate ledger saves. Pool writes lock the trip row and recheck the acknowledged balance before allowing an overdraft.

## Commands and evidence limits

- `npm test`: fast in-process setup, money, allocation and accounting unit tests.
- `npm run test:integration`: migration/functions against isolated PGlite PostgreSQL, including real RLS, constraints, atomic rollback and retries. Supabase Auth identity and publication setup are controlled fixtures; this does not prove hosted Auth or WebSocket delivery.
- `npm run test:e2e`: phone and desktop Chromium journeys through the actual browser UI and Next.js API to real embedded PostgreSQL. A loopback-only Auth/PostgREST protocol fixture substitutes the external Supabase service. It uses port 3001, fixture port 55441 and `.next-test`, leaving your normal dev server alone. Install its browser with `npx playwright install chromium`.
- `npm run typecheck`, `npm run lint`, `npm run build`: static and production-build verification.

The browser fixture is a test process only; it is not imported by the application or used as a fallback for a misconfigured production database. Hosted anonymous sign-in, provider rate limits, realtime authorization/delivery, deployment cookies and cross-tab/session refresh still require the real-service smoke test above. The UI reports connection failures and offers Refresh rather than claiming stale data is current. No payment or settlement mutation exists.

The UI follows the provided design's visual direction and confirmed updates. `design.pen` remains a user-owned source and is not rewritten by this implementation. Independent review has not been requested or performed.
