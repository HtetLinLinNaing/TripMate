# Manual trip close

## Intent

Give organisers an explicit way to finalise a trip once the group has finished entering spending. A completed trip must preserve its final balances and cannot accept further contributions or expenses.

## Goals

- An organiser can end an active trip after confirming the irreversible action.
- Every member can still view the completed trip, its ledger, and their final bill.
- The UI clearly identifies completed trips.
- The server rejects ledger writes after completion, regardless of the client UI.

## Non-goals

- Automatically ending a trip on its scheduled end date.
- Editing or reopening a completed trip.
- Settling payments or sending notifications.

## Constraints

- Keep the existing Next.js client, API route, and Supabase RPC architecture.
- Preserve the current `draft` and `active` behaviour.
- Only the organiser may close a trip.

## Approaches considered

1. Manual final close: the organiser confirms an **End trip** action. This keeps late receipts possible until the organiser decides the ledger is final. **Selected.**
2. Automatic close on the scheduled end date: less effort for organisers but can prevent valid late entries.
3. Soft close that permits later ledger changes: flexible, but it does not provide a final balance.

## Design

- Add `completed` as a trip status and an RPC action that transitions only an organiser-owned active trip to it.
- Place an organiser-only **End trip** control on the active ledger and require the existing confirmation UI before submitting it.
- Display completed trips as **Completed** in the trip list and show a completed-state notice in the ledger.
- Retain read access and all balance calculations for completed trips.
- Update contribution and expense RPC guards to accept only `active` trips.
- Cover the close transition and post-close write rejection with automated tests.

## Builder decisions

- Closing is permanent for this version; reopening requires a future, separately designed feature.
- Existing invitation behaviour remains unchanged because active invitations are not a ledger-write path.
