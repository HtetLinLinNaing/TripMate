"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button, TextField, Label, Input } from "@heroui/react";
import { Icon } from "@iconify-icon/react";
import Confirmation from "./confirmation";
import icons from "@iconify-json/lucide/icons.json";
import { browserDb, ensureIdentity } from "@/lib/supabase-browser";
import {
  allocate,
  billFor,
  canStart,
  money,
  parseMoney,
  toCents,
  tripTotals,
  validateTrip,
  type Snapshot,
  type Trip,
} from "@/lib/accounting";
type View =
  | "home"
  | "create"
  | "join"
  | "board"
  | "ledger"
  | "funds"
  | "expense"
  | "bill"
  | "detail";
type Part = { label: string; amount: string; members: string[] };
type Invitation = { id?: string; name: string; existing: boolean };
const invalidInvite =
  "This invitation is no longer valid. Ask the organiser for a new link.";
function tripStatusLabel(status: Trip["status"]) {
  if (status === "draft") return "Waiting for group";
  if (status === "active") return "Active";
  return "Completed";
}
function Glyph({ name }: { name: keyof typeof icons.icons }) {
  return (
    <Icon
      aria-hidden="true"
      icon={{ ...icons.icons[name], width: 24, height: 24 }}
      width="20"
      height="20"
    />
  );
}
function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  maxLength = 100,
  required = true,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <TextField
      className="field"
      name={name}
      isRequired={required}
      value={value}
      onChange={onChange}
    >
      <Label>{label}</Label>
      <Input
        type={type}
        maxLength={maxLength}
        inputMode={name === "amount" ? "decimal" : undefined}
      />
    </TextField>
  );
}
async function api(query: string, body?: unknown) {
  const response = await fetch(
    `/api/tripmate${query}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Unable to complete this request.");
  return result.data;
}
export default function TripMate() {
  const [view, setView] = useState<View>("home"),
    [ready, setReady] = useState(false),
    [user, setUser] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [invite, setInvite] = useState<Invitation | null>(null),
    [token, setToken] = useState(""),
    [detail, setDetail] = useState("");
  const [name, setName] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [startsOn, setStartsOn] = useState(""),
    [endsOn, setEndsOn] = useState(""),
    [notes, setNotes] = useState("");
  const [contributor, setContributor] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState("");
  const [description, setDescription] = useState(""),
    [payer, setPayer] = useState(""),
    [source, setSource] = useState("personal"),
    [mode, setMode] = useState("everyone");
  const [selected, setSelected] = useState<string[]>([]),
    [parts, setParts] = useState<Part[]>([
      { label: "", amount: "", members: [] },
    ]);
  const [confirmBalance, setConfirmBalance] = useState<number | null>(null),
    [holder, setHolder] = useState(""),
    [confirmEnd, setConfirmEnd] = useState(false);
  const operation = useRef(""),
    submitting = useRef(false);
  const refresh = useCallback(async (id: string) => {
    const data: Snapshot = await api(`?trip=${id}`);
    setSnapshot(data);
    setView((current) =>
      current === "board" && data.trip.status === "active" ? "ledger" : current,
    );
    return data;
  }, []);
  const openTrip = useCallback(
    async (id: string) => {
      const data = await refresh(id);
      window.history.pushState({}, "", `/?trip=${id}`);
      setView(data.trip.status === "draft" ? "board" : "ledger");
      setError("");
    },
    [refresh],
  );
  const initialise = useCallback(async () => {
    setError("");
    setReady(false);
    try {
      const id = await ensureIdentity();
      setUser(id);
      const params = new URLSearchParams(window.location.search),
        inviteToken = params.get("invite"),
        tripId = params.get("trip");
      if (inviteToken) {
        setToken(inviteToken);
        const data: Invitation | null = await api(
          `?invite=${encodeURIComponent(inviteToken)}`,
        );
        setInvite(data);
        if (data?.existing && data.id) await openTrip(data.id);
        else {
          setView("join");
          if (!data) setError(invalidInvite);
        }
      } else if (tripId) await openTrip(tripId);
      else {
        setTrips(await api(""));
        setSnapshot(null);
        setView("home");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect.");
    } finally {
      setReady(true);
    }
  }, [openTrip]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void initialise();
    });
    const back = () => void initialise();
    window.addEventListener("popstate", back);
    return () => {
      active = false;
      window.removeEventListener("popstate", back);
    };
  }, [initialise]);
  const tripId = snapshot?.trip.id;
  useEffect(() => {
    if (!tripId || !user) return;
    const db = browserDb(),
      channel = db.channel(`trip-${tripId}`);
    for (const table of ["trips", "memberships", "contributions", "expenses"])
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `${table === "trips" ? "id" : "trip_id"}=eq.${tripId}`,
        },
        () => {
          void refresh(tripId).catch(() =>
            setNotice("Live refresh failed. Use Refresh to retry."),
          );
        },
      );
    channel.subscribe((status: string) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        setNotice(
          "Live connection interrupted. Use Refresh to load current data.",
        );
    });
    return () => {
      void db.removeChannel(channel);
    };
  }, [tripId, user, refresh]);
  async function run(work: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to complete this action.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function go(next: View) {
    setView(next);
    setError("");
    setNotice("");
    setConfirmBalance(null);
    operation.current = crypto.randomUUID();
    if (next === "funds") {
      setContributor(user);
      setAmount("");
      setNote("");
    }
    if (next === "expense") {
      setPayer(user);
      setAmount("");
      setDescription("");
      setSource("personal");
      setMode("everyone");
      setSelected([]);
      setParts([{ label: "", amount: "", members: [] }]);
    }
  }
  const members = snapshot?.members ?? [],
    trip = snapshot?.trip,
    organiser = trip?.organiser_id === user;
  const memberName = (id: string) =>
    members.find((m) => m.user_id === id)?.display_name || "Trip member";
  const totals = snapshot
      ? tripTotals(snapshot.contributions, snapshot.expenses)
      : null,
    bill = snapshot
      ? billFor(
          user,
          snapshot.contributions,
          snapshot.expenses,
          snapshot.allocations,
        )
      : null;
  const expense = snapshot?.expenses.find((e) => e.id === detail);
  const title: Record<View, string> = {
    home: "Good trips. Clear balances.",
    create: "Start together.",
    join: "Join the trip.",
    board: trip?.name || "Your group",
    ledger: trip?.name || "Trip ledger",
    funds: "Add funds",
    expense: "New expense",
    bill: "Your bill",
    detail: expense?.description || "Expense details",
  };
  const toggle = (items: string[], id: string) =>
    items.includes(id) ? items.filter((x) => x !== id) : [...items, id];
  let preview: { label: string; shares: ReturnType<typeof allocate> }[] = [],
    previewError = "";
  if (view === "expense" && amount)
    try {
      const cents = parseMoney(amount),
        active = members.map((m) => m.user_id);
      if (mode === "mixed") {
        if (!parts.length || parts.length > 50)
          throw new Error("Add between one and fifty parts.");
        if (parts.reduce((sum, p) => sum + parseMoney(p.amount), 0) !== cents)
          throw new Error("Expense parts must equal the total.");
        preview = parts.map((p) => {
          if (!p.label.trim()) throw new Error("Name each expense part.");
          return {
            label: p.label,
            shares: allocate(parseMoney(p.amount), p.members, active),
          };
        });
      } else
        preview = [
          {
            label: mode === "everyone" ? "Everyone" : "Selected people",
            shares: allocate(
              cents,
              mode === "everyone" ? active : selected,
              active,
            ),
          },
        ];
    } catch (e) {
      previewError = e instanceof Error ? e.message : "Check the split.";
    }
  async function saveExpense(confirmed?: number) {
    if (!trip || previewError || !preview.length)
      throw new Error(previewError || "Enter a valid expense and split.");
    const payload = {
      description,
      payer,
      source,
      mode,
      cents: parseMoney(amount),
      members: selected,
      parts:
        mode === "mixed"
          ? parts.map((p) => ({
              label: p.label,
              cents: parseMoney(p.amount),
              members: p.members,
            }))
          : [],
      operation: operation.current,
      ...(confirmed !== undefined ? { confirmedBalance: confirmed } : {}),
    };
    try {
      await api("", { action: "expense", trip: trip.id, expense: payload });
      setConfirmBalance(null);
      await refresh(trip.id);
      go("ledger");
      setNotice("Expense saved.");
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("POOL_CONFIRM:")) {
        setConfirmBalance(Number(e.message.split(":")[1]));
        return;
      }
      throw e;
    }
  }
  async function completeTrip(tripId: string) {
    await api("", { action: "complete", trip: tripId });
    setConfirmEnd(false);
    await refresh(tripId);
    setNotice("Trip completed. The ledger is now final.");
  }
  const submit = (event: FormEvent, work: () => Promise<void>) => {
    event.preventDefault();
    void run(work);
  };
  const peoplePicker = (values: string[], change: (ids: string[]) => void) => (
    <div className="people-picker">
      {members.map((m) => (
        <label
          className={values.includes(m.user_id) ? "chosen" : ""}
          key={m.user_id}
        >
          <input
            type="checkbox"
            checked={values.includes(m.user_id)}
            onChange={() => change(toggle(values, m.user_id))}
          />
          {m.display_name}
        </label>
      ))}
    </div>
  );
  const memberSelect = (
    label: string,
    value: string,
    change: (id: string) => void,
  ) => (
    <label className="field">
      {label}
      <select required value={value} onChange={(e) => change(e.target.value)}>
        <option value="">Select person</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.display_name}
          </option>
        ))}
      </select>
    </label>
  );
  const back = () =>
    go(trip?.status === "draft" ? "board" : trip ? "ledger" : "home");
  let content: ReactNode;
  if (!ready) content = <p role="status">Opening your private trip space…</p>;
  else if (!user)
    content = (
      <div className="empty">
        <p>We couldn’t open your private session.</p>
        <Button onPress={() => void initialise()}>Try again</Button>
      </div>
    );
  else
    switch (view) {
      case "home":
        content = (
          <>
            <p className="intro">
              One trip, one shared ledger. Keep the memories; we’ll keep the
              maths clear.
            </p>
            <Button className="primary" onPress={() => go("create")}>
              Create a trip <Glyph name="arrow-right" />
            </Button>
            <form
              className="join-code"
              onSubmit={(event) =>
                submit(event, async () => {
                  if (!token.trim())
                    throw new Error("Paste your invitation link or code.");
                  const code = token.includes("?")
                    ? new URL(token).searchParams.get("invite") || ""
                    : token.trim();
                  window.history.pushState(
                    {},
                    "",
                    `/?invite=${encodeURIComponent(code)}`,
                  );
                  await initialise();
                })
              }
            >
              <Field
                label="Have an invitation?"
                name="invite"
                value={token}
                onChange={setToken}
                required={false}
              />
              <Button type="submit" variant="secondary" isDisabled={busy}>
                Open invitation
              </Button>
            </form>
            <h2>Your trips</h2>
            {trips.length ? (
              trips.map((t) => (
                <button
                  className="trip-card"
                  key={t.id}
                  onClick={() => void run(() => openTrip(t.id))}
                >
                  <span>
                    <strong>{t.name}</strong>
                    <small>
                      {t.starts_on} → {t.ends_on}
                    </small>
                  </span>
                  <span className="tag">{tripStatusLabel(t.status)}</span>
                </button>
              ))
            ) : (
              <p className="muted">
                Your next adventure starts here. Create a trip or open a
                friend’s invitation.
              </p>
            )}
          </>
        );
        break;
      case "create":
        content = (
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                validateTrip({ name, displayName, startsOn, endsOn });
                const id = await api("", {
                  action: "create",
                  input: { name, displayName, startsOn, endsOn, notes },
                });
                await openTrip(id);
              })
            }
          >
            <p className="intro">
              Create a trip, share one invitation, and let the group build the
              ledger.
            </p>
            <Field
              label="Your display name"
              name="displayName"
              value={displayName}
              onChange={setDisplayName}
              maxLength={60}
            />
            <Field
              label="Trip name"
              name="name"
              value={name}
              onChange={setName}
            />
            <div className="date-grid">
              <Field
                label="Start date"
                name="startsOn"
                type="date"
                value={startsOn}
                onChange={setStartsOn}
              />
              <Field
                label="End date"
                name="endsOn"
                type="date"
                value={endsOn}
                onChange={setEndsOn}
              />
            </div>
            <label className="field">
              Bus stops / notes · optional
              <textarea
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="One stop per line"
              />
            </label>
            <Button type="submit" className="primary" isDisabled={busy}>
              Create invitation <Glyph name="arrow-right" />
            </Button>
            <p className="muted">Cash holder is chosen after people join.</p>
          </form>
        );
        break;
      case "join":
        content = invite ? (
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const id = await api("", {
                  action: "join",
                  token,
                  displayName,
                });
                await openTrip(id);
              })
            }
          >
            <p className="intro">
              No account. Add your display name and you’re in.
            </p>
            <Field
              label="Your display name"
              name="displayName"
              value={displayName}
              onChange={setDisplayName}
              maxLength={60}
            />
            <div className="soft">
              <strong>{invite.name}</strong>
              <p>You’ll appear in the group immediately.</p>
            </div>
            <Button type="submit" className="primary" isDisabled={busy}>
              Join {invite.name} <Glyph name="arrow-right" />
            </Button>
          </form>
        ) : (
          <div className="empty">
            <p>Ask the organiser for a new invitation, then open their link.</p>
            <Button
              onPress={() => {
                window.history.pushState({}, "", "/");
                void initialise();
              }}
            >
              Back to your trips
            </Button>
          </div>
        );
        break;
      case "board":
        content = trip && (
          <>
            <p className="muted">
              {trip.starts_on} – {trip.ends_on} · {members.length} people joined
            </p>
            {organiser && snapshot?.invitation && (
              <div className="invite-box">
                <span>Private invitation</span>
                <Button
                  variant="tertiary"
                  onPress={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(
                        `${window.location.origin}/?invite=${snapshot.invitation}`,
                      );
                      setNotice("Invite link copied.");
                    })
                  }
                >
                  Share <Glyph name="copy" />
                </Button>
              </div>
            )}
            <p className="eyebrow">People · {members.length} joined</p>
            <ul className="member-list">
              {members.map((m) => (
                <li key={m.user_id}>
                  <span className="avatar">
                    {m.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{m.display_name}</strong>
                    <small>
                      {m.role === "organiser" ? "Organiser" : "Joined"}
                      {trip.cash_holder_id === m.user_id
                        ? " · Cash holder"
                        : ""}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            {organiser ? (
              <>
                <div className="soft">
                  <label className="field">
                    Choose cash holder
                    <select
                      required
                      value={holder || trip.cash_holder_id || ""}
                      onChange={(event) => {
                        const id = event.target.value;
                        setHolder(id);
                        void run(async () => {
                          await api("", {
                            action: "configure",
                            trip: trip.id,
                            holder: id,
                            start: false,
                          });
                          await refresh(trip.id);
                        });
                      }}
                    >
                      <option value="">Select person</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Button
                  className="primary"
                  isDisabled={
                    busy ||
                    !canStart(true, members.length) ||
                    !(holder || trip.cash_holder_id)
                  }
                  onPress={() =>
                    void run(async () => {
                      await api("", {
                        action: "configure",
                        trip: trip.id,
                        holder: holder || trip.cash_holder_id,
                        start: true,
                      });
                      await refresh(trip.id);
                      go("ledger");
                    })
                  }
                >
                  Start trip <Glyph name="arrow-right" />
                </Button>
                {members.length < 2 && (
                  <p className="muted">Invite one more person to start.</p>
                )}
                {!trip.cash_holder_id && (
                  <p className="muted">
                    Choose the member who will hold the shared funds.
                  </p>
                )}
              </>
            ) : (
              <p className="soft">
                Waiting for the organiser to start the trip.
              </p>
            )}
          </>
        );
        break;
      case "ledger":
        content = snapshot && totals && (
          <>
            <p className="muted">
              {members.length} people · Cash holder:{" "}
              {trip?.cash_holder_id
                ? memberName(trip.cash_holder_id)
                : "Not assigned"}
            </p>
            <div className="balance">
              <span className="eyebrow">Shared pool · remaining</span>
              <strong>{money(totals.remaining)}</strong>
            </div>
            <div className="metrics">
              <div>
                <span className="eyebrow">Total contributed</span>
                <strong>{money(totals.contributed)}</strong>
              </div>
              <div className="used">
                <span className="eyebrow">Total used</span>
                <strong>{money(totals.used)}</strong>
              </div>
            </div>
            <h2>Funds added</h2>
            {snapshot.contributions.length ? (
              snapshot.contributions.map((c) => (
                <div className="ledger-row" key={c.id}>
                  <span>
                    {memberName(c.contributor_id)}
                    <small>
                      {c.note || "Pool contribution"} · recorded by{" "}
                      {memberName(c.recorder_id || "")} ·{" "}
                      {c.created_at
                        ? new Date(c.created_at).toLocaleString()
                        : ""}
                    </small>
                  </span>
                  <strong className="green">+{money(toCents(c.amount))}</strong>
                </div>
              ))
            ) : (
              <p className="muted">
                No funds yet. Record money received by the cash holder.
              </p>
            )}
            <h2>Expenses</h2>
            {snapshot.expenses.length ? (
              snapshot.expenses.map((e) => (
                <button
                  className="ledger-row expense-link"
                  key={e.id}
                  onClick={() => {
                    setDetail(e.id);
                    go("detail");
                  }}
                >
                  <span>
                    {e.description}
                    <small>
                      {e.created_at
                        ? new Date(e.created_at).toLocaleString()
                        : ""}
                    </small>
                  </span>
                  <strong>{money(toCents(e.amount))}</strong>
                </button>
              ))
            ) : (
              <p className="muted">
                No expenses yet. Add your first shared purchase.
              </p>
            )}
            {snapshot.trip.status === "completed" ? (
              <p className="soft">
                <strong>Completed</strong>
                <br />
                This ledger is final. New funds and expenses are locked.
              </p>
            ) : (
              <>
                <div className="action-grid">
                  <Button className="secondary" onPress={() => go("funds")}>
                    <Glyph name="plus" />
                    Add funds
                  </Button>
                  <Button className="primary" onPress={() => go("expense")}>
                    <Glyph name="plus" />
                    Add expense
                  </Button>
                </div>
                {organiser && (
                  <Button
                    variant="tertiary"
                    isDisabled={busy}
                    onPress={() => setConfirmEnd(true)}
                  >
                    End trip
                  </Button>
                )}
              </>
            )}
            <Button
              className="bill-link"
              variant="tertiary"
              onPress={() => go("bill")}
            >
              View your personal bill <Glyph name="arrow-right" />
            </Button>
          </>
        );
        break;
      case "funds":
        content = trip && (
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                await api("", {
                  action: "contribute",
                  trip: trip.id,
                  member: contributor,
                  cents: parseMoney(amount),
                  note,
                  operation: operation.current,
                });
                await refresh(trip.id);
                go("ledger");
                setNotice("Contribution saved.");
              })
            }
          >
            <p className="intro">
              Record money actually received by the cash holder.
            </p>
            {memberSelect("Received from", contributor, setContributor)}
            <Field
              label="Amount (THB)"
              name="amount"
              value={amount}
              onChange={setAmount}
            />
            <Field
              label="Note · optional"
              name="note"
              required={false}
              value={note}
              onChange={setNote}
              maxLength={500}
            />
            <p className="soft">
              Cash holder:{" "}
              {trip.cash_holder_id
                ? memberName(trip.cash_holder_id)
                : "Not assigned"}
            </p>
            <Button type="submit" className="secondary" isDisabled={busy}>
              Save contribution
            </Button>
          </form>
        );
        break;
      case "expense":
        content = (
          <form onSubmit={(event) => submit(event, () => saveExpense())}>
            <Field
              label="What was it?"
              name="description"
              value={description}
              onChange={setDescription}
              maxLength={200}
            />
            {memberSelect("Who paid?", payer, setPayer)}
            <fieldset>
              <legend>Paid from</legend>
              <div className="segmented">
                {["personal", "shared_pool"].map((s) => (
                  <label key={s} className={source === s ? "active" : ""}>
                    <input
                      type="radio"
                      name="source"
                      checked={source === s}
                      onChange={() => setSource(s)}
                    />
                    {s === "personal" ? "Personal" : "Shared pool"}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field
              label="Total (THB)"
              name="amount"
              value={amount}
              onChange={setAmount}
            />
            <fieldset>
              <legend>Share this expense</legend>
              <div className="split-options">
                {[
                  ["everyone", "Everyone", "Split equally with all members"],
                  [
                    "selected",
                    "Selected people",
                    "Choose who shares this expense",
                  ],
                  [
                    "mixed",
                    "Mixed expense",
                    "Split different parts with different people",
                  ],
                ].map(([value, label, hint]) => (
                  <label key={value} className={mode === value ? "active" : ""}>
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === value}
                      onChange={() => setMode(value)}
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {mode === "selected" && (
              <fieldset>
                <legend>Split with</legend>
                {peoplePicker(selected, setSelected)}
              </fieldset>
            )}
            {mode === "mixed" && (
              <fieldset>
                <legend>Expense parts</legend>
                {parts.map((p, index) => (
                  <div className="part" key={index}>
                    <Field
                      label={`Part ${index + 1} name`}
                      name={`part-label-${index}`}
                      value={p.label}
                      onChange={(v) =>
                        setParts(
                          parts.map((x, i) =>
                            i === index ? { ...x, label: v } : x,
                          ),
                        )
                      }
                    />
                    <Field
                      label={`Part ${index + 1} amount (THB)`}
                      name={`part-amount-${index}`}
                      value={p.amount}
                      onChange={(v) =>
                        setParts(
                          parts.map((x, i) =>
                            i === index ? { ...x, amount: v } : x,
                          ),
                        )
                      }
                    />
                    {peoplePicker(p.members, (ids) =>
                      setParts(
                        parts.map((x, i) =>
                          i === index ? { ...x, members: ids } : x,
                        ),
                      ),
                    )}
                    <Button
                      variant="tertiary"
                      isDisabled={parts.length === 1}
                      onPress={() =>
                        setParts(parts.filter((_, i) => i !== index))
                      }
                    >
                      Remove part
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  isDisabled={parts.length >= 50}
                  onPress={() =>
                    setParts([...parts, { label: "", amount: "", members: [] }])
                  }
                >
                  + Add part
                </Button>
              </fieldset>
            )}
            {previewError && (
              <p className="hint" role="status">
                {previewError}
              </p>
            )}
            {preview.length > 0 && !previewError && (
              <section className="soft" aria-label="Split preview">
                <h2>Each person’s share</h2>
                {preview.map((p, i) => (
                  <div key={i}>
                    <p className="eyebrow">{p.label}</p>
                    {p.shares.map((s) => (
                      <div className="row" key={s.memberId}>
                        <span>{memberName(s.memberId)}</span>
                        <strong>{money(s.cents)}</strong>
                      </div>
                    ))}
                  </div>
                ))}
                {mode === "mixed" && (
                  <>
                    <hr />
                    <p className="eyebrow">Total per person</p>
                    {members
                      .map((m) => ({
                        id: m.user_id,
                        cents: preview.reduce(
                          (s, p) =>
                            s +
                            p.shares
                              .filter((x) => x.memberId === m.user_id)
                              .reduce((n, x) => n + x.cents, 0),
                          0,
                        ),
                      }))
                      .filter((m) => m.cents > 0)
                      .map((m) => (
                        <div className="row" key={m.id}>
                          <span>{memberName(m.id)}</span>
                          <strong>{money(m.cents)}</strong>
                        </div>
                      ))}
                  </>
                )}
                <p className="muted">
                  Any extra satang goes in stable member order. Total:{" "}
                  {money(parseMoney(amount))}.
                </p>
              </section>
            )}
            <Button
              type="submit"
              className="primary"
              isDisabled={busy || !!previewError || !preview.length}
            >
              Save expense
            </Button>
          </form>
        );
        break;
      case "bill":
        content = snapshot && bill && (
          <>
            <p className="muted">
              {memberName(user)} · {members.length} people
            </p>
            <p className="eyebrow">Shared costs</p>
            {bill.items
              .filter((a) => !a.is_extra)
              .map((a, i) => (
                <div className="ledger-row" key={i}>
                  <span>
                    {
                      snapshot.expenses.find((e) => e.id === a.expense_id)
                        ?.description
                    }
                    <small>{a.part_label}</small>
                  </span>
                  <strong>{money(toCents(a.amount))}</strong>
                </div>
              ))}
            <p className="eyebrow">Your extras</p>
            {bill.items
              .filter((a) => a.is_extra)
              .map((a, i) => (
                <div className="ledger-row" key={i}>
                  <span>{a.part_label}</span>
                  <strong>{money(toCents(a.amount))}</strong>
                </div>
              ))}
            {!bill.items.length && (
              <p className="muted">
                Your bill will appear when expenses are recorded.
              </p>
            )}
            <div className="row total">
              <strong>Total share</strong>
              <strong>{money(bill.shared + bill.extras)}</strong>
            </div>
            <div className="soft">
              <div className="row">
                <span>Paid in</span>
                <strong>− {money(bill.paidIn)}</strong>
              </div>
              {bill.personalCredit > 0 && (
                <div className="row">
                  <span>Paid personally</span>
                  <strong>− {money(bill.personalCredit)}</strong>
                </div>
              )}
            </div>
            <div className="settlement row">
              <span className="eyebrow">
                {bill.net < 0
                  ? "You get back"
                  : bill.net > 0
                    ? "You owe"
                    : "All balanced"}
              </span>
              <strong>{money(Math.abs(bill.net))}</strong>
            </div>
            <p className="muted">
              This is your ledger position. TripMate does not move money.
            </p>
            <Button variant="secondary" onPress={() => go("ledger")}>
              Review shared ledger
            </Button>
          </>
        );
        break;
      case "detail":
        content = expense && snapshot && (
          <>
            <div className="detail-grid">
              <p>
                <span className="eyebrow">Paid by</span>
                <strong>{memberName(expense.payer_id)}</strong>
              </p>
              <p>
                <span className="eyebrow">Paid from</span>
                <strong>
                  {expense.payment_source === "personal"
                    ? "Personal"
                    : "Shared pool"}
                </strong>
              </p>
            </div>
            <div className="balance">
              <span className="eyebrow">Expense total</span>
              <strong>{money(toCents(expense.amount))}</strong>
            </div>
            <h2>Allocated shares</h2>
            {snapshot.allocations
              .filter((a) => a.expense_id === expense.id)
              .map((a, i) => (
                <div className="ledger-row" key={i}>
                  <span>
                    {memberName(a.member_id)}
                    <small>{a.part_label}</small>
                  </span>
                  <strong>{money(toCents(a.amount))}</strong>
                </div>
              ))}
            <p className="muted">
              Recorded by {memberName(expense.recorder_id || "")} ·{" "}
              {expense.created_at
                ? new Date(expense.created_at).toLocaleString()
                : ""}
            </p>
            <p className="muted">
              Saved entries are permanent. Editing and reversals are outside
              this MVP.
            </p>
          </>
        );
        break;
    }
  return (
    <div className="app-shell">
      <header className="site-header">
        <button
          className="brand"
          onClick={() => {
            window.history.pushState({}, "", "/");
            void initialise();
          }}
        >
          <Glyph name="wallet" />
          <span>
            TripMate<span className="brand-dot">.</span>
          </span>
        </button>
        <span className="header-caption">SHARED TRIPS, SIMPLER.</span>
      </header>
      <main className={`workspace ${view === "ledger" ? "wide" : ""}`}>
        <div className="page-top">
          {view !== "home" && (
            <button className="back" onClick={back}>
              <Glyph name="arrow-left" />
              Back
            </button>
          )}
          {trip && (
            <Button
              variant="tertiary"
              isDisabled={busy}
              onPress={() =>
                void run(async () => {
                  await refresh(trip.id);
                  setNotice("Up to date.");
                })
              }
            >
              Refresh
            </Button>
          )}
        </div>
        <p className="eyebrow">
          {view === "board"
            ? "Waiting for group"
            : view === "ledger"
              ? tripStatusLabel(trip?.status ?? "active")
              : view === "bill"
                ? trip?.name
                : "TripMate · shared expenses"}
        </p>
        <h1>{title[view]}</h1>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {content}
        {busy && (
          <p className="muted" role="status">
            Saving your changes…
          </p>
        )}
      </main>
      <footer className="site-footer">
        Made for the journey. Accounted for together.
      </footer>
      {confirmBalance !== null && (
        <Confirmation busy={busy} onCancel={() => setConfirmBalance(null)}>
          <h2 id="confirmation-title">Pool funds are short</h2>
          <p>
            This expense will leave the pool{" "}
            {money(parseMoney(amount) - confirmBalance)} below zero.
          </p>
          <p className="muted">
            Record it only if the group expects this shortfall.
          </p>
          <div className="action-grid">
            <Button
              autoFocus
              variant="secondary"
              isDisabled={busy}
              onPress={() => setConfirmBalance(null)}
            >
              Cancel
            </Button>
            <Button
              className="primary"
              isDisabled={busy}
              onPress={() => void run(() => saveExpense(confirmBalance))}
            >
              Save anyway
            </Button>
          </div>
        </Confirmation>
      )}
      {confirmEnd && trip && (
        <Confirmation
          busy={busy}
          labelledBy="end-trip-title"
          onCancel={() => setConfirmEnd(false)}
        >
          <h2 id="end-trip-title">End {trip.name}?</h2>
          <p>This locks the ledger so no one can add funds or expenses.</p>
          <p className="muted">You can still review the final balances.</p>
          <div className="action-grid">
            <Button
              autoFocus
              variant="secondary"
              isDisabled={busy}
              onPress={() => setConfirmEnd(false)}
            >
              Cancel
            </Button>
            <Button
              className="primary"
              isDisabled={busy}
              onPress={() => void run(() => completeTrip(trip.id))}
            >
              End trip
            </Button>
          </div>
        </Confirmation>
      )}
    </div>
  );
}
