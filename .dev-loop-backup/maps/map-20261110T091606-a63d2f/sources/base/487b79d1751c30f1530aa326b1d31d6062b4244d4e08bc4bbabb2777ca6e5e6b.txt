# TripMate MVP — Product Requirements Document

**Status:** Draft  
**Product:** TripMate  
**Scope:** Mobile-first shared-trip expense tracking  
**Currency:** Thai baht (THB) for the MVP

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
- A member cannot join the same trip twice using the same account or device identity.
- Expired, invalid, and revoked invitations must show an actionable error.

### FR-3: Manage the group

- The group board lists joined members and the trip organiser.
- The organiser can invite additional members and set one cash holder.
- The organiser can start the trip once at least two members have joined.
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
- The UI must show the calculated allocation before the expense is saved.
- Allocations must total exactly the entered expense amount. Any rounding remainder is assigned deterministically and visibly.
- A split cannot contain zero people or a negative allocation.

### FR-7: View the active ledger

- The active ledger displays current pool balance, recent activity, total used, and prominent actions for adding funds and expenses.
- Members can identify which entries were paid personally versus from the pool.
- Ledger totals update after a saved contribution or expense.
- If a shared-pool expense exceeds available funds, TripMate must warn the user and require an explicit confirmation before recording it as a negative pool balance.

### FR-8: View a personal bill

- A member can see an itemised breakdown of shared-cost allocations and personal extras.
- The bill shows the member’s total share, money paid into the pool, and net amount due or credit.
- The calculation should be explainable from ledger entries; no total may appear without a corresponding breakdown.

## 8. Business rules and calculations

| Metric | Definition |
| --- | --- |
| Shared pool balance | Contributions into the pool minus expenses paid from the shared pool |
| Member shared-cost total | Sum of that member’s allocations from shared expenses |
| Member personal extras | Expenses allocated only to that member |
| Paid into pool | Sum of contributions attributed to that member |
| Net settlement position | Member shared-cost total + personal extras − paid into pool − personally paid expense credits |

Personal-payment credits ensure a member who personally covers a shared cost is not charged for the full cost again. The exact settlement label (for example, “You owe” or “You are owed”) is derived from the net settlement position.

## 9. Data entities

| Entity | Required fields |
| --- | --- |
| User | ID, display name, account/device identity |
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

For the MVP, TripMate provides a copyable invitation link or code. Sending messages, push notifications, email delivery, reminders, and payment requests are deferred. Members see updates when they next open the trip.

## 12. Authentication and privacy

- A lightweight sign-in or persistent device identity is required to prevent duplicate membership and associate activity with a person.
- Trips are private: only invited members may access trip data.
- A member may see only the trips they belong to.
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

The MVP is ready for testing when a group can create and join a private trip, assign a cash holder, record THB contributions, record personal and shared-pool expenses, use all three split methods, see accurate shared-pool and personal totals, and understand each member’s resulting due/credit position without external calculations.
