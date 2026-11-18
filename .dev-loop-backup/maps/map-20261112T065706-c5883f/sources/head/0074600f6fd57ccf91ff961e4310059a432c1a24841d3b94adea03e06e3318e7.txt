import { describe, expect, it } from "vitest";
import {
  allocate,
  billFor,
  money,
  parseMoney,
  tripTotals,
  validateTrip,
  canStart,
} from "../src/lib/accounting";

describe("trip setup", () => {
  it("TC2 rejects missing names, impossible or reversed dates", () => {
    for (const input of [
      {
        name: "",
        displayName: "May",
        startsOn: "2026-07-11",
        endsOn: "2026-07-14",
      },
      {
        name: "Trip",
        displayName: "May",
        startsOn: "2026-02-30",
        endsOn: "2026-03-02",
      },
      {
        name: "Trip",
        displayName: "May",
        startsOn: "2026-07-14",
        endsOn: "2026-07-11",
      },
    ])
      expect(() => validateTrip(input)).toThrow();
  });
  it("TC5 requires organiser authority and two active members including organiser", () => {
    expect(canStart(false, 3)).toBe(false);
    expect(canStart(true, 1)).toBe(false);
    expect(canStart(true, 2)).toBe(true);
  });
});
describe("exact THB money", () => {
  it("TC7 rejects zero, negative, malformed, overflow and fractional satang", () => {
    for (const amount of [
      "0",
      "-1",
      "NaN",
      "1e3",
      "1.001",
      "10000000000",
      "",
      "1,000",
    ])
      expect(() => parseMoney(amount)).toThrow();
    expect(parseMoney("1000.01")).toBe(100001);
    expect(money(12100)).toBe("฿121.00");
  });
  it("TC10 splits ฿121 exactly and assigns the remainder by stable ID", () => {
    expect(allocate(12100, ["c", "b", "a"])).toEqual([
      { memberId: "a", cents: 4034 },
      { memberId: "b", cents: 4033 },
      { memberId: "c", cents: 4033 },
    ]);
  });
  it("TC11 rejects empty, duplicate, foreign participants and non-positive shares", () => {
    for (const ids of [[], ["a", "a"], ["foreign"]])
      expect(() => allocate(100, ids, ["a", "b"])).toThrow();
    expect(() => allocate(1, ["a", "b"])).toThrow();
  });
  it("TC19 selected and mixed parts charge only their groups and reconcile", () => {
    const selected = allocate(6900, ["c", "a"]);
    const everyone = allocate(7500, ["a", "b", "c"]);
    expect(selected).toEqual([
      { memberId: "a", cents: 3450 },
      { memberId: "c", cents: 3450 },
    ]);
    expect([...selected, ...everyone].reduce((s, a) => s + a.cents, 0)).toBe(
      14400,
    );
  });
});
describe("accounting projection", () => {
  const contributions = [
    { contributor_id: "a", amount: 1000 },
    { contributor_id: "b", amount: 1000 },
  ];
  const expenses = [
    { id: "e1", payer_id: "a", payment_source: "shared_pool", amount: 761 },
    { id: "e2", payer_id: "b", payment_source: "personal", amount: 121 },
  ];
  const allocations = [
    {
      expense_id: "e1",
      member_id: "a",
      amount: 380.5,
      part_label: "Group",
      is_extra: false,
    },
    {
      expense_id: "e2",
      member_id: "a",
      amount: 40.34,
      part_label: "Coffee",
      is_extra: false,
    },
    {
      expense_id: "e1",
      member_id: "a",
      amount: 20,
      part_label: "Drink",
      is_extra: true,
    },
  ];
  it("TC14 explains allocations, extras, contributions, personal credits and net", () => {
    expect(billFor("a", contributions, expenses, allocations)).toMatchObject({
      shared: 42084,
      extras: 2000,
      paidIn: 100000,
      personalCredit: 0,
      net: -55916,
    });
    expect(billFor("b", contributions, expenses, allocations)).toMatchObject({
      personalCredit: 12100,
      net: -112100,
    });
  });
  it("TC14 excludes personal payments from pool spending and includes all expenses in total used", () => {
    expect(tripTotals(contributions, expenses)).toEqual({
      contributed: 200000,
      used: 88200,
      poolUsed: 76100,
      remaining: 123900,
    });
  });
});
