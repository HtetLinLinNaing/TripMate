import { NextResponse } from "next/server";
import { serverDb } from "@/lib/supabase-server";
import { validateTrip } from "@/lib/accounting";
import { sameOrigin } from "@/lib/request-origin";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function safeError(message: string) {
  if (message.startsWith("POOL_CONFIRM:")) return message;
  if (
    /^(This invitation|Enter |Choose |Only the organiser|Only active trips|This is a completed trip|Invite one more|Start the trip|Each share|Expense parts|Operation already|Too many trips|You do not have access|Invalid |Add valid)/.test(
      message,
    )
  )
    return message;
  return "Unable to save or load this trip. Check your inputs and retry. If this persists, check the database migration and anonymous Auth setup.";
}
export async function GET(request: Request) {
  try {
    const db = await serverDb();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      return json(
        { error: "Your session could not be verified. Please retry." },
        401,
      );
    const params = new URL(request.url).searchParams;
    if (params.has("invite")) {
      const token = params.get("invite")!;
      if (!/^[a-f0-9]{64}$/i.test(token)) return json({ data: null });
      const result = await db.rpc("invitation_context", { p_token: token });
      return result.error
        ? json({ error: safeError(result.error.message) }, 400)
        : json({ data: result.data });
    }
    if (params.has("trip")) {
      const id = params.get("trip");
      if (!uuid(id)) return json({ error: "Invalid trip link." }, 400);
      const result = await db.rpc("trip_snapshot", { p_trip: id });
      return result.error
        ? json({ error: safeError(result.error.message) }, 403)
        : json({ data: result.data });
    }
    // RLS restricts this list to trips in the caller's membership.
    const result = await db
      .from("trips")
      .select("id,name,status,starts_on,ends_on")
      .order("created_at", { ascending: false });
    return result.error
      ? json({ error: safeError(result.error.message) }, 400)
      : json({ data: result.data });
  } catch {
    return json({ error: "TripMate is unavailable. Please retry." }, 503);
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host")))
    return json({ error: "Request origin is not allowed." }, 403);
  try {
    const text = await request.text();
    if (text.length > 32000)
      return json({ error: "Request is too large." }, 413);
    const body = JSON.parse(text);
    const db = await serverDb();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      return json(
        { error: "Your session could not be verified. Please retry." },
        401,
      );
    let name: string;
    let args: Record<string, unknown>;
    if (body.action === "create") {
      validateTrip(body.input);
      name = "create_trip";
      args = { p: body.input };
    } else if (body.action === "join") {
      if (!/^[a-f0-9]{64}$/i.test(body.token))
        return json(
          {
            error:
              "This invitation is no longer valid. Ask the organiser for a new link.",
          },
          400,
        );
      name = "join_trip";
      args = { p_token: body.token, p_name: body.displayName };
    } else {
      if (!uuid(body.trip)) return json({ error: "Invalid trip." }, 400);
      if (body.action === "configure") {
        name = "configure_trip";
        args = {
          p_trip: body.trip,
          p_holder: body.holder,
          p_start: body.start === true,
        };
      } else if (body.action === "complete") {
        name = "complete_trip";
        args = { p_trip: body.trip };
      } else if (body.action === "contribute") {
        name = "save_contribution";
        args = {
          p_trip: body.trip,
          p_member: body.member,
          p_cents: body.cents,
          p_note: body.note,
          p_operation: body.operation,
        };
      } else if (body.action === "expense") {
        name = "save_expense";
        args = { p_trip: body.trip, p: body.expense };
      } else return json({ error: "Unknown action." }, 400);
    }
    const result = await db.rpc(name, args);
    return result.error
      ? json({ error: safeError(result.error.message) }, 400)
      : json({ data: result.data });
  } catch (error) {
    return json(
      {
        error:
          error instanceof SyntaxError
            ? "Invalid request."
            : error instanceof Error &&
                error.message.startsWith("Choose valid dates")
              ? error.message
              : "Unable to save. Check required fields and try again.",
      },
      400,
    );
  }
}
