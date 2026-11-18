import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const may = "00000000-0000-4000-8000-000000000001",
  niran = "00000000-0000-4000-8000-000000000002",
  outsider = "00000000-0000-4000-8000-000000000003";
let trip: string, token: string;
async function as<T = Record<string, unknown>>(
  user: string,
  sql: string,
  params: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    return tx.query<T>(sql, params);
  });
}
async function rpc<T = string>(user: string, name: string, args: unknown[]) {
  const result = await as<{ value: T }>(
    user,
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
    args,
  );
  return result.rows[0].value;
}
const expense = (extra: Record<string, unknown> = {}) => ({
  operation: randomUUID(),
  description: "Dinner",
  payer: may,
  source: "personal",
  mode: "everyone",
  cents: 12100,
  members: [],
  parts: [],
  ...extra,
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create publication supabase_realtime;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202611100001_tripmate.sql", "utf8"),
  );
  await db.query("insert into auth.users values ($1),($2),($3)", [
    may,
    niran,
    outsider,
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential("isolated PostgreSQL schema, RLS and transactions", () => {
  it("TC1 creates the trip, organiser and invitation atomically", async () => {
    trip = await rpc(may, "create_trip", [
      {
        name: "Mom Jam",
        displayName: "May",
        startsOn: "2026-07-11",
        endsOn: "2026-07-14",
        notes: "Chiang Mai",
      },
    ]);
    const result = await db.query<{ token: string }>(
      "select token from public.invitations where trip_id=$1",
      [trip],
    );
    token = result.rows[0].token;
    const snapshot = await rpc<{
      members: unknown[];
      trip: { currency: string };
    }>(may, "trip_snapshot", [trip]);
    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.trip.currency).toBe("THB");
    expect(token).toHaveLength(64);
  });
  it("TC3 joins exactly once and TC18 returns an existing trip", async () => {
    expect(await rpc(niran, "join_trip", [token, "Niran"])).toBe(trip);
    expect(await rpc(niran, "join_trip", [token, "Different name"])).toBe(trip);
    const result = await db.query(
      "select * from public.memberships where trip_id=$1",
      [trip],
    );
    expect(result.rows).toHaveLength(2);
    await db.query(
      "update public.invitations set status='revoked' where trip_id=$1",
      [trip],
    );
    expect(await rpc(niran, "invitation_context", [token])).toMatchObject({
      id: trip,
      existing: true,
    });
    expect(await rpc(niran, "join_trip", [token, ""])).toBe(trip);
  });
  it("TC4 refuses revoked, expired and unknown invitations for new members", async () => {
    await expect(rpc(outsider, "join_trip", [token, "Other"])).rejects.toThrow(
      "This invitation is no longer valid",
    );
    await db.query(
      "update public.invitations set status='active',expires_at=now()-interval '1 day' where trip_id=$1",
      [trip],
    );
    await expect(rpc(outsider, "join_trip", [token, "Other"])).rejects.toThrow(
      "This invitation is no longer valid",
    );
    expect(
      await rpc(outsider, "invitation_context", ["f".repeat(64)]),
    ).toBeNull();
    await db.query(
      "update public.invitations set expires_at=null where trip_id=$1",
      [trip],
    );
  });
  it("TC17 sets the cash holder and starts two members; non-organiser is denied", async () => {
    await expect(
      rpc(niran, "configure_trip", [trip, niran, true]),
    ).rejects.toThrow("Only the organiser");
    await rpc(may, "configure_trip", [trip, niran, true]);
    expect(await rpc(may, "trip_snapshot", [trip])).toMatchObject({
      trip: { status: "active", cash_holder_id: niran },
    });
  });
  it("TC6 saves contributions and retries without duplicates", async () => {
    const operation = randomUUID();
    const id = await rpc(may, "save_contribution", [
      trip,
      may,
      100000,
      "Cash",
      operation,
    ]);
    expect(
      await rpc(may, "save_contribution", [
        trip,
        may,
        100000,
        "Cash",
        operation,
      ]),
    ).toBe(id);
    await expect(
      rpc(may, "save_contribution", [trip, may, 100001, "Cash", operation]),
    ).rejects.toThrow("Operation already");
    await rpc(niran, "save_contribution", [
      trip,
      niran,
      100000,
      "",
      randomUUID(),
    ]);
  });
  it("TC8 saves a personal expense and its exact allocations atomically", async () => {
    const body = expense();
    const id = await rpc(may, "save_expense", [trip, body]);
    expect(await rpc(may, "save_expense", [trip, body])).toBe(id);
    const result = await db.query<{ amount: string }>(
      "select amount from public.allocations where expense_id=$1 order by member_id",
      [id],
    );
    expect(result.rows.map((r) => Number(r.amount))).toEqual([60.5, 60.5]);
    const balances = await db.query<{ amount: string }>(
      "select sum(amount) as amount from public.expenses where trip_id=$1 and payment_source='shared_pool'",
      [trip],
    );
    expect(balances.rows[0].amount).toBeNull();
  });
  it("TC9 requires fresh overdraft acknowledgement and saves only after explicit confirmation", async () => {
    const body = expense({ source: "shared_pool", cents: 220000 });
    await expect(rpc(may, "save_expense", [trip, body])).rejects.toThrow(
      "POOL_CONFIRM:200000",
    );
    await expect(
      rpc(may, "save_expense", [trip, { ...body, confirmedBalance: 1 }]),
    ).rejects.toThrow("POOL_CONFIRM:200000");
    await rpc(may, "save_expense", [
      trip,
      { ...body, confirmedBalance: 200000 },
    ]);
  });
  it("TC19 persists mixed parts and TC11 rolls back invalid total or foreign participants", async () => {
    const body = expense({
      mode: "mixed",
      cents: 14400,
      parts: [
        { label: "Coffee", cents: 6900, members: [may] },
        { label: "Driver", cents: 7500, members: [may, niran] },
      ],
    });
    const id = await rpc(may, "save_expense", [trip, body]);
    const result = await db.query<{ sum: string }>(
      "select sum(amount) from public.allocations where expense_id=$1",
      [id],
    );
    expect(Number(result.rows[0].sum)).toBe(144);
    const before = await db.query("select id from public.expenses");
    await expect(
      rpc(may, "save_expense", [
        trip,
        expense({
          mode: "mixed",
          parts: [{ label: "Wrong", cents: 1, members: [may] }],
        }),
      ]),
    ).rejects.toThrow("Expense parts must equal");
    await expect(
      rpc(may, "save_expense", [
        trip,
        expense({ mode: "selected", members: [outsider] }),
      ]),
    ).rejects.toThrow("Choose current");
    expect(
      (await db.query("select id from public.expenses")).rows,
    ).toHaveLength(before.rows.length);
  });
  it("TC13 prevents outsider reads, writes and protected RPC access", async () => {
    expect(
      (await as(outsider, "select * from public.trips")).rows,
    ).toHaveLength(0);
    expect(
      (await as(outsider, "select * from public.expenses")).rows,
    ).toHaveLength(0);
    expect(
      (await as(outsider, "select * from public.memberships")).rows,
    ).toHaveLength(0);
    await expect(rpc(outsider, "trip_snapshot", [trip])).rejects.toThrow(
      "You do not have access",
    );
    await expect(
      rpc(outsider, "save_expense", [trip, expense()]),
    ).rejects.toThrow("You do not have access");
    await expect(
      as(may, "update public.expenses set amount=1 where trip_id=$1", [trip]),
    ).rejects.toThrow("permission denied");
    await expect(
      as(may, "delete from public.contributions where trip_id=$1", [trip]),
    ).rejects.toThrow("permission denied");
    await expect(as(may, "select * from public.invitations")).rejects.toThrow(
      "permission denied",
    );
  });
});
