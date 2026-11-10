import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./supabase";

type Report = { id: string; code: string; type: string; location: string; phone: string | null; description: string; created_at: string };
type Post = { id: string; category: string; title: string; body: string; created_at: string };
type Vote = { user_id: string; initiative: string; choice: "agree" | "disagree" };

const initiatives = [
  { id: "park", title: "Community pocket park on Rizal Street" },
  { id: "market", title: "Expanded weekend market hours" },
];

/* ---------- live data from Supabase ---------- */
function useLive<T>(table: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false });
      if (!alive) return;
      if (error) setError(true); else { setRows(data as T[]); setError(false); }
    };
    load();
    const channel = supabase.channel(`live-${table}`).on("postgres_changes", { event: "*", schema: "public", table }, load).subscribe();
    return () => { alive = false; supabase.removeChannel(channel); };
  }, [table]);
  return { rows, error };
}

/* ---------- grouping similar complaints ---------- */
const STOP = new Set(["the", "a", "an", "of", "in", "on", "at", "near", "beside", "behind", "corner", "street", "st", "road", "rd", "ave", "avenue", "barangay", "brgy", "purok", "along", "by", "and", "to", "is", "are", "was", "has", "have", "there", "this", "that", "with", "for", "from", "it", "its", "our", "we", "my", "very", "so", "sa", "ng", "na", "ang"]);
const words = (t: string) => Array.from(new Set(String(t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))));
const shared = (a: string[], b: string[]) => a.filter((w) => b.includes(w)).length;

function groupSimilar(rows: Report[]) {
  const info = rows.map((r) => ({ loc: words(r.location), desc: words(r.description) }));
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].type !== rows[j].type) continue;
      const a = info[i], b = info[j];
      const locMatch = a.loc.length > 0 && b.loc.length > 0 && shared(a.loc, b.loc) / Math.min(a.loc.length, b.loc.length) >= 0.5;
      const descMatch = shared(a.desc, b.desc) >= 3 && shared(a.desc, b.desc) / Math.min(a.desc.length, b.desc.length) >= 0.5;
      if (locMatch || descMatch) parent[find(i)] = find(j);
    }
  }
  const map = new Map<number, Report[]>();
  rows.forEach((r, i) => { const k = find(i); map.set(k, [...(map.get(k) || []), r]); });
  return Array.from(map.values()).map((items) => {
    const counts: Record<string, number> = {};
    items.forEach((r) => { const l = r.location.trim(); counts[l] = (counts[l] || 0) + 1; });
    const place = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return { type: items[0].type, place, items };
  }).sort((a, b) => b.items.length - a.items.length || b.items[0].created_at.localeCompare(a.items[0].created_at));
}

/* ---------- small shared pieces ---------- */
const inputCls = "mt-2 w-full rounded-xl border border-slate-200 bg-white p-3.5 text-sm outline-none focus:border-blue-400";
const btnPrimary = "rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-800 disabled:opacity-60";

function Header({ title, copy }: { title: string; copy: string }) {
  return <div className="mb-6"><div className="text-2xl font-bold tracking-tight">{title}</div><p className="mt-1 max-w-2xl text-sm text-slate-500">{copy}</p></div>;
}

function DeleteButton({ onConfirm, label = "Delete" }: { onConfirm: () => Promise<void>; label?: string }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ask) return <button onClick={() => setAsk(true)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50" type="button">{label}</button>;
  return <span className="flex items-center gap-2">
    <span className="text-xs font-semibold text-rose-600">Delete permanently?</span>
    <button disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setAsk(false); } }} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60" type="button">{busy ? "Deleting…" : "Yes"}</button>
    <button disabled={busy} onClick={() => setAsk(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600" type="button">Cancel</button>
  </span>;
}

/* ---------- Reports ---------- */
function ReportCard({ r }: { r: Report }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{r.type}</span><span className="text-xs font-bold text-slate-400">{r.code}</span></div>
      <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
    </div>
    <p className="mt-3 text-sm leading-6 text-slate-700">{r.description}</p>
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-sm text-slate-500">
      <span>📍 {r.location}</span>
      {r.phone ? <a href={`tel:${r.phone.replace(/[^0-9+]/g, "")}`} className="font-semibold text-blue-700">📞 {r.phone}</a> : <span className="text-slate-400">No contact number given</span>}
      <span className="ml-auto"><DeleteButton onConfirm={async () => { await supabase.from("reports").delete().eq("id", r.id); }} /></span>
    </div>
  </article>;
}

function Reports() {
  const { rows, error } = useLive<Report>("reports");
  const [view, setView] = useState<"grouped" | "all">("grouped");
  if (error) return <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Reports couldn’t be loaded. Check that this account is listed as an official.</p>;
  if (!rows) return <p className="text-sm text-slate-400">Loading reports…</p>;
  const groups = groupSimilar(rows);
  const multi = groups.filter((g) => g.items.length > 1);
  const single = groups.filter((g) => g.items.length === 1).flatMap((g) => g.items);
  return <>
    <Header title="Resident reports" copy="Issues submitted by residents, updated live. Similar complaints are grouped so recurring problems stand out." />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-bold text-slate-600">{rows.length} {rows.length === 1 ? "report" : "reports"}{multi.length > 0 && ` · ${multi.length} recurring`}</p>
      <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold">
        {(["grouped", "all"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 ${view === v ? "bg-blue-700 text-white" : "text-slate-500"}`} type="button">{v === "grouped" ? "Similar complaints" : "All reports"}</button>)}
      </div>
    </div>
    {rows.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No reports yet.</div>}
    {view === "all" && <div className="space-y-4">{rows.map((r) => <ReportCard key={r.id} r={r} />)}</div>}
    {view === "grouped" && <div className="space-y-6">
      {multi.map((g) => <section key={g.items[0].id} className="rounded-3xl border border-amber-200 bg-amber-50/50 p-4 md:p-5">
        <div className="mb-4 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-sm font-bold text-amber-800">{g.items.length}</span><div><div className="font-bold">{g.type}{g.place && ` · ${g.place}`}</div><div className="text-xs text-slate-500">{g.items.length} similar complaints</div></div></div>
        <div className="space-y-3">{g.items.map((r) => <ReportCard key={r.id} r={r} />)}</div>
      </section>)}
      {single.length > 0 && <section><div className="mb-3 text-sm font-bold text-slate-500">Other reports ({single.length})</div><div className="space-y-4">{single.map((r) => <ReportCard key={r.id} r={r} />)}</div></section>}
    </div>}
  </>;
}

/* ---------- Announcements ---------- */
function Announcements() {
  const { rows, error } = useLive<Post>("announcements");
  const [category, setCategory] = useState("Community");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function post(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const { error } = await supabase.from("announcements").insert({ category, title: title.trim(), body: body.trim() });
    setBusy(false);
    if (error) { setMsg("Couldn’t post: " + error.message); return; }
    setTitle(""); setBody(""); setMsg("Posted! Residents can see it now.");
  }
  return <>
    <Header title="Announcements" copy="Posts appear on the resident site straight away." />
    <form onSubmit={post} className="mb-8 rounded-2xl border border-blue-200 bg-blue-50/60 p-5 md:p-6">
      <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
        <label className="text-sm font-bold text-slate-700">Category<select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>{["Community", "Public Works", "Health", "Public Safety", "Notice"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm font-bold text-slate-700">Title<input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Water interruption this Friday" /></label>
      </div>
      <label className="mt-4 block text-sm font-bold text-slate-700">Message<textarea required maxLength={800} rows={3} value={body} onChange={(e) => setBody(e.target.value)} className={inputCls} placeholder="Write the details residents need to know" /></label>
      <div className="mt-4 flex items-center gap-4"><button disabled={busy} className={btnPrimary} type="submit">{busy ? "Posting…" : "Post announcement"}</button>{msg && <span className="text-sm text-slate-600">{msg}</span>}</div>
    </form>
    {error && <p className="text-sm text-amber-700">Announcements couldn’t be loaded.</p>}
    {rows && rows.length === 0 && <p className="text-sm text-slate-500">Nothing posted yet.</p>}
    <div className="grid gap-4 md:grid-cols-2">{rows?.map((p) => <article key={p.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{p.category}</span><span className="text-xs text-slate-400">{new Date(p.created_at).toLocaleDateString()}</span></div>
      <div className="mt-3 font-bold">{p.title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-500">{p.body}</p>
      <div className="mt-4 flex justify-end border-t border-slate-100 pt-4"><DeleteButton onConfirm={async () => { await supabase.from("announcements").delete().eq("id", p.id); }} /></div>
    </article>)}</div>
  </>;
}

/* ---------- Votes ---------- */
function Votes() {
  const { rows, error } = useLive<Vote & { created_at: string }>("votes");
  if (error) return <p className="text-sm text-amber-700">Votes couldn’t be loaded.</p>;
  if (!rows) return <p className="text-sm text-slate-400">Loading votes…</p>;
  return <>
    <Header title="Live voting results" copy="Counts update as residents vote." />
    <div className="space-y-5">{initiatives.map((i) => {
      const agree = rows.filter((r) => r.initiative === i.id && r.choice === "agree").length;
      const disagree = rows.filter((r) => r.initiative === i.id && r.choice === "disagree").length;
      const total = agree + disagree;
      const pct = total ? Math.round((agree / total) * 100) : 0;
      return <article key={i.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div className="font-bold">{i.title}</div><span className="text-xs font-bold text-slate-500">{total} {total === 1 ? "vote" : "votes"}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-blue-50 p-4"><div className="text-3xl font-bold text-blue-700">{agree}</div><div className="mt-1 text-xs font-bold text-blue-700/80">Agree · {pct}%</div></div>
          <div className="rounded-xl bg-slate-100 p-4"><div className="text-3xl font-bold text-slate-700">{disagree}</div><div className="mt-1 text-xs font-bold text-slate-600">Disagree · {total ? 100 - pct : 0}%</div></div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${pct}%` }} /></div>
      </article>;
    })}</div>
  </>;
}

/* ---------- Login + shell ---------- */
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr("Incorrect email or password.");
  }
  return <div className="mx-auto mt-16 max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
    <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">VOXA · Barangay 463</div>
    <div className="mt-2 text-2xl font-bold">Officials sign in</div>
    <p className="mt-2 text-sm text-slate-500">This site is only for barangay officials.</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm font-bold text-slate-700">Email<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></label>
      <label className="block text-sm font-bold text-slate-700">Password<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} /></label>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <button disabled={busy} className={btnPrimary} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  </div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [official, setOfficial] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"reports" | "announcements" | "votes">("reports");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setOfficial(null);
    if (!session) return;
    supabase.from("officials").select("user_id").eq("user_id", session.user.id).maybeSingle().then(({ data }) => setOfficial(!!data));
  }, [session]);

  if (!configured) return <div className="m-8 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Supabase isn’t configured. Copy <code>.env.example</code> to <code>.env.local</code> and fill in your project URL and anon key.</div>;
  if (!ready) return <p className="m-8 text-sm text-slate-400">Loading…</p>;
  if (!session) return <Login />;
  if (official === null) return <p className="m-8 text-sm text-slate-400">Checking access…</p>;
  if (!official) return <div className="mx-auto mt-16 max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
    <div className="text-xl font-bold">Not an official account</div>
    <p className="mt-2 text-sm text-slate-500">{session.user.email} isn’t on the list of barangay officials.</p>
    <button onClick={() => supabase.auth.signOut()} className={btnPrimary + " mt-5"} type="button">Sign out</button>
  </div>;

  const tabs = [["reports", "Reports"], ["announcements", "Announcements"], ["votes", "Votes"]] as const;
  return <div className="min-h-screen">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div><div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">VOXA Officials</div><div className="font-bold">Barangay 463</div></div>
        <div className="flex items-center gap-3 text-sm"><span className="hidden text-slate-500 sm:inline">{session.user.email}</span><button onClick={() => supabase.auth.signOut()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600" type="button">Sign out</button></div>
      </div>
      <nav className="mx-auto flex max-w-5xl gap-1 px-4">{tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`border-b-2 px-4 py-3 text-sm font-bold ${tab === id ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500"}`} type="button">{label}</button>)}</nav>
    </header>
    <main className="mx-auto max-w-5xl px-4 py-8">{tab === "reports" ? <Reports /> : tab === "announcements" ? <Announcements /> : <Votes />}</main>
  </div>;
}
