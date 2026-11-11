# TripMate MVP — Product Requirements Document

**Status:** Aligned with confirmed plan, revision 2
**Product:** TripMate  
**Scope:** Mobile-first shared-trip expense tracking  
**Currency:** Thai baht (THB) for the MVP

**Governing plan:** [.dev-loop/plans/tripmate-mvp/plan-preview.json](../.dev-loop/plans/tripmate-mvp/plan-preview.json), confirmed revision 2. The plan retains the technical design, stable S/A IDs, and planned test cases. Alignment does not claim implementation or test completion.

## 1. Product summary

TripMate helps a private group travelling together record money contributed to a shared pool, log expenses, split costs fairly, and understand who owes what. It replaces informal chat messages and error-prone spreadsheets with a clear, shared ledger.

The MVP tracks money only. It does not move money between people or connect to payment providers.

## 2. Problem

Friends on a trip often pay for different items at different times: transport, meals, tickets, and shared supplies. Groups lose track of who paid, which expenses came from pooled cash, and how much each member ultimately owes. Reconciling everything at the end of the trip is slow and can create disagreements.

## 3. Goals

- Let a trip organiser create a private trip and invite people quickly.
- Give every member one current, understandable view of the group’s funds and spending.
- Support common expense-sharing cases without manual calculations.
- Show each traveller their personal bill and the basis for the total.
- Keep an auditable record of every contribution and expense.

## 4. Non-goals

- Processing card, bank, wallet, or in-app payments.
- Settling debts automatically.
- Public trips, discovery, or social networking.
- Multi-currency conversion or exchange-rate handling.
- Advanced budgeting, receipt scanning, tax reporting, or accounting integrations.

## 5. Users

### Trip organiser

Creates the trip, shares the invitation, manages participants, selects the cash holder, and starts the trip.

### Trip member

Joins through an invitation, views the ledger, contributes money, records expenses when permitted, and checks their personal bill.

## 6. Core experience

1. An organiser creates a trip with their display name, trip name, dates, and optional bus-stop/location details.
2. TripMate creates a private invitation link or code for the organiser to share.
3. Members join using the invitation and provide a display name.
4. The group board shows participants and lets the organiser assign a cash holder before the trip starts.
5. Members add funds to the shared pool as contributions are received.
6. A member logs each expense, choosing who paid and whether it came from personal money or the shared pool.
7. The payer selects an equal, selected-member, or mixed split.
8. The active ledger updates balances, total used, recent activity, and available pool funds.
9. Each member can open their personal bill to see their share of shared costs, personal extras, contributions, and total due or credit.

## 7. Functional requirements

### FR-1: Create a trip

- The organiser can enter a display name, trip name, start date, end date, and optional trip notes/locations.
- The trip name, organiser display name, and valid dates are required.
- The end date cannot precede the start date.
- Creating a trip makes the organiser its first member and opens a shareable invitation.

### FR-2: Join a trip

- A person can join a private trip through a valid invitation link or code.
- Joining requires a display name.
- The join screen displays an invitation note or trip context before confirmation.
- Membership uses a persistent anonymous Supabase Auth identity created automatically; new members enter only a display name, with no registration form. If an existing member reopens an invitation on the same browser, take them straight to their existing trip without creating another membership.
- New joins through expired, invalid, or revoked invitations show: “This invitation is no longer valid. Ask the organiser for a new link.” Existing-member access is based on membership, not the invitation’s validity.

### FR-3: Manage the group

- The group board lists joined members and the trip organiser, and receives authorised realtime updates when invited members join.
- The organiser can invite additional members and select one current member as cash holder. Only the organiser can assign this role or start the trip.
- Start trip stays disabled until there are at least two active members, including the organiser.
- The cash holder is a role for the shared-pool workflow; it does not grant ownership of other members’ funds.

### FR-4: Record a contribution

- A member can record money received from a selected trip member into the shared pool.
- A contribution includes contributor, amount in THB, and an optional note.
- Amount must be greater than zero and stored with two decimal places at most.
- Saving a contribution updates the shared-pool balance and the contributor’s paid-into-pool total.
- Every contribution appears in recent activity with its author and timestamp.

### FR-5: Record an expense

- A member can enter an expense description, payer, payment source, amount, and split method.
- Payment source is either **Personal** or **Shared pool**.
- Personal means the selected payer covered the purchase outside the pool.
- Shared pool means the expense reduces the available group-pool balance.
- The amount must be greater than zero.
- Saving an expense creates an immutable ledger entry; correcting one is handled by a future edit/reversal workflow rather than silent replacement.

### FR-6: Split an expense

- **Everyone:** divide the expense equally among all active trip members.
- **Selected people:** divide the expense equally among the members chosen by the payer.
- **Mixed:** divide one expense into named parts, each with its own amount and assigned member(s).
- Every split method shows each person’s exact calculated share before saving, including Everyone and Mixed. For ฿121 split among three people, show ฿40.34, ฿40.33, and ฿40.33 with deterministic remainder assignment.
- Allocations must total exactly the entered expense amount. Any rounding remainder is assigned deterministically and visibly.
- A split must include active trip members, and every saved allocation must be greater than zero. Reject empty participant groups, invalid participants, zero or negative allocations, and allocations that do not reconcile to the expense total.

### FR-7: View the active ledger

- The active ledger prominently shows remaining pool balance, with total contributed shown separately, alongside recent activity, total used, and actions for adding funds or expenses. With ฿2,000 contributed and ฿761 paid from the pool, show ฿1,239 remaining.
- Keep the expense list simple. Opening an expense’s details shows its payer and Personal / Shared pool source.
- Ledger totals update after a saved contribution or expense. Other authorised members viewing the trip receive realtime updates without reopening it.
- If a shared-pool expense exceeds available funds, TripMate must warn the user and show the resulting shortfall with Cancel and Save anyway. Only explicit Save anyway confirmation records the negative pool balance.

### FR-8: View a personal bill

- A member can see an itemised breakdown of shared-cost allocations and personal extras.
- The bill shows the member’s total share, money paid into the pool, personal-payment credits, and net amount due or credit. Members can return to the shared ledger to reconcile bill items with activity.
- Show a separate “Paid personally” credit row when applicable.
- The calculation should be explainable from ledger entries; no total may appear without a corresponding breakdown.

## 8. Business rules and calculations

| Metric | Definition |
| --- | --- |
| Shared pool balance | Contributions into the pool minus expenses paid from the shared pool |
| Member shared-cost total | Sum of shared-cost allocations, excluding allocations separately shown as personal extras |
| Member personal extras | Expenses allocated only to that member |
| Paid into pool | Sum of contributions attributed to that member |
| Net settlement position | Member shared-cost total + personal extras − paid into pool − personally paid expense credits |

Personal-payment credits ensure a member who personally covers a shared cost is not charged for the full cost again. The exact settlement label (for example, “You owe” or “You are owed”) is derived from the net settlement position.

## 9. Data entities

| Entity | Required fields |
| --- | --- |
| User | Supabase Auth user ID, display name |
| Trip | ID, name, organiser ID, start date, end date, status, currency |
| Membership | Trip ID, user ID, role, joined date, active status |
| Invitation | Trip ID, invitation token, status, expiry, creator ID |
| Contribution | ID, trip ID, contributor ID, recorder ID, amount, note, timestamp |
| Expense | ID, trip ID, description, payer ID, payment source, total amount, recorder ID, timestamp |
| Expense allocation | Expense ID, member ID, amount, allocation type/part label |

## 10. UX requirements

- The product is mobile-first and follows the screen flow in `design.pen`, while providing a convenient responsive web experience on tablets and desktops.
- Currency must consistently display as THB with a readable numeric format.
- Forms must validate required inputs inline before allowing save/continue.
- Saving should show a clear success state and return the user to the updated ledger or next split step.
- The ledger must prioritise clarity over dense financial detail: visible balance, recent changes, and clear action buttons.
- Personal bills must make it possible for a member to challenge or understand a calculation without asking the organiser.
- Empty states must guide groups to add members, funds, or the first expense.

## 11. Notifications and invitations

For the MVP, TripMate provides a copyable invitation link or code. Sending messages, push notifications, email delivery, reminders, and payment requests are deferred. In-app realtime updates are included: authorised viewers see new contributions, expenses, and group-board membership changes while viewing the trip. Reopening the trip loads current persisted state.

## 12. Authentication and privacy

- Supabase Auth with Next.js SSR support provides persistent identity for membership, attribution, and protected sessions. Identity is created anonymously behind the scenes; joining requires only a display name. Returning access depends on retaining the anonymous session in the same browser.
- Trips are private: only authorised active trip members may read or mutate trip data. Application access checks and Supabase Postgres Row Level Security enforce these boundaries.
- A member may see only the trips they belong to. Realtime subscriptions must enforce the same membership restrictions and never expose another trip’s data.
- The product stores only the information necessary for membership, ledger activity, and display names in the MVP.

## 13. Success metrics

- At least 80% of created trips have two or more joined members.
- At least 60% of started trips record one or more contribution or expense.
- At least 50% of active members view their personal bill before a trip ends.
- Fewer than 5% of recorded expenses require a correction or reversal once that capability is added.

## 14. Future enhancements

- Payment links and local wallet/bank integration.
- Mark-as-settled actions and settlement reminders.
- Push/email invitations and activity notifications.
- Receipt attachments and scanning.
- Expense editing, reversals, and audit exports.
- Multiple currencies and exchange-rate support.
- Role permissions beyond organiser and cash holder.

## 15. MVP acceptance criteria

These criteria retain the IDs and wording of the confirmed plan. They describe intended outcomes, not executed verification.

- **A1** (S1): An organiser creates a trip with valid required details and receives a private invitation.
- **A2** (S1, S7): A valid invite lets a person join once; invalid, expired, or revoked invitations show an actionable error. Existing members on the same browser return to their trip without another membership.
- **A3** (S1): An organiser can assign a cash holder and start a trip only after at least two members join.
- **A4** (S2, S5): A positive contribution updates the pool balance, contributor total, and activity feed.
- **A5** (S3, S5): A personal or shared-pool expense records its payer, source, and amount; a negative pool balance requires confirmation.
- **A6** (S4): Equal, selected-member, and mixed allocations total exactly to the expense amount and reject invalid participants or allocations.
- **A7** (S3, S5): The active ledger shows current remaining pool balance, total contributed, recent activity, and total used; payer and payment source are available in expense details.
- **A8** (S5): A member's bill itemises allocations, contributions, personal-payment credit, and resulting due or credit position.
- **A9** (S6): The primary flows remain usable on phone, tablet, and desktop widths with accessible controls.
- **A10** (S7): Unauthorised users cannot read or mutate a trip, including through realtime updates.
- **A11** (S8): No payment transfer, currency conversion, or automated settlement action is exposed in the MVP.

## 16. Confirmed delivery and verification approach

- One responsive Next.js App Router application with TypeScript supports phone, tablet, and desktop browsers.
- Tailwind CSS and HeroUI provide the accessible, design-aligned interface. Core Iconify collections are bundled locally.
- Supabase provides Auth, durable Postgres storage with migrations and Row Level Security, and authorised realtime change delivery.
- Expense records and their allocations are saved atomically. Persisted money uses THB decimal precision, exact reconciled totals, and deterministic displayed rounding.
- The plan defines unit verification of validation, allocation and balance logic; integration verification of persistence and access boundaries; and browser verification of responsive journeys and authorised live updates. Its TC IDs remain authoritative; no passing-test claims are made here.
- Payment processing, currency conversion, outbound notifications, receipt capture, and settlement write actions remain deferred.
