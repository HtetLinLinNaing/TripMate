/** All calculations use integer satang; database decimals are converted only at the boundary. */
export const MAX_CENTS = 999_999_999_999;
export function parseMoney(value: string): number {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error(
      "Enter a positive THB amount with at most two decimal places.",
    );
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS)
    throw new Error("Amount is outside the supported range.");
  return cents;
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-TH", {
    style: "currency",
    currency: "THB",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(cents / 100);
export const toCents = (amount: number | string) =>
  Math.round(Number(amount) * 100);
export function allocate(
  cents: number,
  memberIds: string[],
  activeIds = memberIds,
) {
  const ids = [...memberIds].sort();
  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    cents > MAX_CENTS ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !activeIds.includes(id)) ||
    cents < ids.length
  )
    throw new Error(
      "Choose valid members and ensure every share is at least ฿0.01.",
    );
  return ids.map((memberId, index) => ({
    memberId,
    cents:
      Math.floor(cents / ids.length) + (index < cents % ids.length ? 1 : 0),
  }));
}
export function validateTrip(input: {
  name: string;
  displayName: string;
  startsOn: string;
  endsOn: string;
}) {
  const validDate = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
  if (
    !input.name.trim() ||
    input.name.trim().length > 100 ||
    !input.displayName.trim() ||
    input.displayName.trim().length > 60
  )
    throw new Error("Enter your name and a trip name.");
  if (
    !validDate(input.startsOn) ||
    !validDate(input.endsOn) ||
    input.endsOn < input.startsOn
  )
    throw new Error("Choose valid dates; end date cannot precede start date.");
}
export const canStart = (organiser: boolean, memberCount: number) =>
  organiser && memberCount >= 2;
export interface Member {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
  trip_id: string;
}
export interface Trip {
  id: string;
  name: string;
  organiser_id: string;
  starts_on: string;
  ends_on: string;
  notes: string;
  status: "draft" | "active" | "completed";
  cash_holder_id: string | null;
}
export interface Contribution {
  id?: string;
  contributor_id: string;
  recorder_id?: string;
  amount: number;
  note?: string;
  created_at?: string;
}
export interface Expense {
  id: string;
  payer_id: string;
  payment_source: string;
  amount: number;
  description?: string;
  created_at?: string;
  recorder_id?: string;
}
export interface Allocation {
  expense_id: string;
  member_id: string;
  amount: number;
  part_label: string;
  is_extra: boolean;
}
export interface Snapshot {
  trip: Trip;
  members: Member[];
  contributions: Contribution[];
  expenses: Expense[];
  allocations: Allocation[];
  invitation: string | null;
}
export function tripTotals(contributions: Contribution[], expenses: Expense[]) {
  const contributed = contributions.reduce(
    (sum, c) => sum + toCents(c.amount),
    0,
  );
  const used = expenses.reduce((sum, e) => sum + toCents(e.amount), 0);
  const poolUsed = expenses
    .filter((e) => e.payment_source === "shared_pool")
    .reduce((sum, e) => sum + toCents(e.amount), 0);
  return { contributed, used, poolUsed, remaining: contributed - poolUsed };
}
export function billFor(
  memberId: string,
  contributions: Contribution[],
  expenses: Expense[],
  allocations: Allocation[],
) {
  const items = allocations.filter((a) => a.member_id === memberId);
  const shared = items
    .filter((a) => !a.is_extra)
    .reduce((s, a) => s + toCents(a.amount), 0);
  const extras = items
    .filter((a) => a.is_extra)
    .reduce((s, a) => s + toCents(a.amount), 0);
  const paidIn = contributions
    .filter((c) => c.contributor_id === memberId)
    .reduce((s, c) => s + toCents(c.amount), 0);
  const personalCredit = expenses
    .filter((e) => e.payer_id === memberId && e.payment_source === "personal")
    .reduce((s, e) => s + toCents(e.amount), 0);
  return {
    items,
    shared,
    extras,
    paidIn,
    personalCredit,
    net: shared + extras - paidIn - personalCredit,
  };
}
