// Local test substitute for Supabase Auth and PostgREST. Real SQL/RLS; no hosted Auth or WebSocket assertions.
import { createServer } from "node:http";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const secret = randomBytes(32),
  db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create publication supabase_realtime;`,
);
await db.exec(
  readFileSync("supabase/migrations/202611100001_tripmate.sql", "utf8"),
);
const users = new Map();
const encode = (data) =>
  Buffer.from(JSON.stringify(data)).toString("base64url");
function session(user) {
  const head = encode({ alg: "HS256", typ: "JWT" }),
    body = encode({
      sub: user.id,
      role: "authenticated",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      is_anonymous: true,
    });
  const signature = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64url");
  return {
    access_token: `${head}.${body}.${signature}`,
    refresh_token: user.id,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}
function identity(token) {
  try {
    const [h, b, s] = token.split(".");
    const expected = createHmac("sha256", secret).update(`${h}.${b}`).digest();
    const received = Buffer.from(s, "base64url");
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      return null;
    const claims = JSON.parse(Buffer.from(b, "base64url"));
    if (claims.exp < Date.now() / 1000) return null;
    return users.get(claims.sub) || null;
  } catch {
    return null;
  }
}
const rpcArgs = {
  create_trip: ["p"],
  invitation_context: ["p_token"],
  join_trip: ["p_token", "p_name"],
  configure_trip: ["p_trip", "p_holder", "p_start"],
  trip_snapshot: ["p_trip"],
  save_contribution: ["p_trip", "p_member", "p_cents", "p_note", "p_operation"],
  save_expense: ["p_trip", "p"],
};
const server = createServer(async (req, res) => {
  const origin = req.headers.origin || "http://127.0.0.1:3001";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "apikey,authorization,content-type,x-client-info,x-supabase-api-version",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Content-Type", "application/json");
  const send = (data, status = 200) => {
    res.statusCode = status;
    res.end(JSON.stringify(data));
  };
  if (req.method === "OPTIONS") {
    send({});
    return;
  }
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 64000) throw new Error("Too large");
    }
    const body = text ? JSON.parse(text) : {};
    if (url.pathname === "/health") {
      send({ ready: true });
      return;
    }
    if (url.pathname === "/auth/v1/signup") {
      const id = randomUUID();
      const user = {
        id,
        aud: "authenticated",
        role: "authenticated",
        email: "",
        phone: "",
        app_metadata: { provider: "anonymous", providers: ["anonymous"] },
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
        is_anonymous: true,
      };
      await db.query("insert into auth.users values($1)", [id]);
      users.set(id, user);
      send(session(user));
      return;
    }
    if (url.pathname === "/auth/v1/token") {
      const user = users.get(body.refresh_token);
      send(
        user ? session(user) : { message: "Session not found" },
        user ? 200 : 401,
      );
      return;
    }
    const user = identity(
      (req.headers.authorization || "").replace("Bearer ", ""),
    );
    if (!user) {
      send({ message: "Invalid session" }, 401);
      return;
    }
    if (url.pathname === "/auth/v1/user") {
      send(user);
      return;
    }
    const value = await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user.id,
      ]);
      if (url.pathname === "/rest/v1/trips")
        return (
          await tx.query(
            "select id,name,status,starts_on,ends_on from public.trips order by created_at desc",
          )
        ).rows;
      const name = url.pathname.replace("/rest/v1/rpc/", ""),
        args = rpcArgs[name];
      if (!args) throw new Error("Unknown test endpoint");
      const result = await tx.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
        args.map((key) => body[key] ?? null),
      );
      return result.rows[0].value;
    });
    send(value);
  } catch (error) {
    send({ message: error.message, code: "P0001" }, 400);
  }
});
server.listen(55441, "127.0.0.1", () =>
  console.log("Isolated Supabase protocol fixture ready on 55441"),
);
async function stop() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
