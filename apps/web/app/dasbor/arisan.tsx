"use client";

import StatusLabel from "../status-label";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { isOverdue, paymentNudge } from "../../lib/payment-nudge";

type Obligation = {
  id: string; memberId: string; name: string; amount: string;
  claimId: string | null; claimStatus: string | null; note: string | null;
};
type Round = {
  id: string; number: number; dueDate: string; status: string;
  recipientId: string | null; recipientName: string | null; obligations: Obligation[];
};
type History = { fundBalance: string; cycle: { closed: boolean; method: string } | null; rounds: Round[] };
type Audit = {
  id: string; action: string; actor: string; createdAt: string;
  details: { roundId?: string; candidates?: string[]; recipientId?: string };
};
type Request = (path: string, method?: string, payload?: object, key?: string) => Promise<unknown>;
const control = "field";
const button = "action";
const status: Record<string, string> = {
  OPEN: "Iuran dibuka", COLLECTED: "Iuran lengkap", PAID_OUT: "Dana dicatat cair", CLOSED: "Ditutup",
  PENDING: "Menunggu pemeriksaan", CONFIRMED: "Pembayaran diterima", REJECTED: "Klaim ditolak",
};
const actions: Record<string, string> = {
  CYCLE_STARTED: "Memulai siklus", CYCLE_CLOSED: "Menutup siklus",
  ROUND_OPENED: "Membuka putaran", ROUND_CLOSED: "Menutup putaran", ROUND_DRAWN: "Mengundi penerima",
  ROUND_PAID_OUT: "Mencatat pencairan", CLAIM_SUBMITTED: "Mengajukan klaim",
  CLAIM_CONFIRMED: "Mengonfirmasi klaim", CLAIM_REJECTED: "Menolak klaim", MEMBER_ROLE_CHANGED: "Mengubah peran anggota",
};
const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export default function Arisan({ group, members, userID, request }: {
  group: { id: string; name: string; role: string };
  members: { id: string; name: string }[];
  userID: string;
  request: Request;
}) {
  const path = `/${group.id}`;
  const [history, setHistory] = useState<History | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [method, setMethod] = useState("DRAW");
  const [order, setOrder] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [keys] = useState(() => new Map<string, string>());
  const owner = group.role === "OWNER";
  const treasurer = owner || group.role === "TREASURER";

  useEffect(() => {
    let active = true;
    void Promise.all([request(path + "/rounds"), request(path + "/audit")]).then(([data, events]) => {
      if (active) { setHistory(data as History); setAudit(events as Audit[]); }
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [path, request]);

  async function mutate(route: string, body: object = {}, money = false) {
    setBusy(true);
    setError("");
    try {
      const key = money ? keys.get(route) ?? crypto.randomUUID() : undefined;
      if (key) keys.set(route, key);
      await request(path + route, "POST", body, key);
      if (key) keys.delete(route);
      const [data, events] = await Promise.all([request(path + "/rounds"), request(path + "/audit")]);
      setHistory(data as History);
      setAudit(events as Audit[]);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Permintaan gagal.");
    } finally {
      setBusy(false);
    }
  }

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = Number(data.get("amount"));
    if (!Number.isSafeInteger(amount) || amount < 1) {
      setError("Masukkan iuran dalam rupiah bulat.");
      return;
    }
    void mutate("/start", {
      amount, frequency: data.get("frequency"), startDate: data.get("start"), orderMethod: method,
      ...(method === "FIXED" ? { order: ordered } : {}),
    });
  }

  const currentIDs = new Set(members.map(({ id }) => id));
  const ordered = [...order.filter((id) => currentIDs.has(id)), ...members.map(({ id }) => id).filter((id) => !order.includes(id))];
  const memberNames = new Map(members.map(({ id, name }) => [id, name]));
  for (const round of history?.rounds ?? []) {
    for (const obligation of round.obligations) memberNames.set(obligation.memberId, obligation.name);
  }

  return (
    <section className="space-y-4 border-y border-stone-300 py-4" aria-label="Putaran arisan">
      <h4 className="text-lg font-semibold">Putaran arisan</h4>
      {error && <p role="alert" className="notice-error">{error}</p>}
      {!history && !error && <p role="status">Memuat putaran…</p>}
      {history?.cycle && <p className="rounded-xl border border-line bg-white p-3 text-ink">Saldo dana <strong className="ml-1 tabular-nums">{currency.format(BigInt(history.fundBalance))}</strong></p>}
      {history && !history.cycle && <p>Belum ada siklus arisan.</p>}
      {history?.cycle?.closed && <p>Siklus terakhir sudah selesai.</p>}
      {history && (!history.cycle || history.cycle.closed) && owner && (
        <form onSubmit={start} className="grid gap-3">
          <label className="grid gap-1">Iuran per orang (Rp)<input name="amount" type="number" min={1} step={1} required className={control} /></label>
          <label className="grid gap-1">Tanggal jatuh tempo pertama<input name="start" type="date" required className={control} /></label>
          <label className="grid gap-1">Frekuensi
            <select name="frequency" className={control}><option value="MONTHLY">Bulanan</option><option value="WEEKLY">Mingguan</option><option value="BIWEEKLY">Dua mingguan</option></select>
          </label>
          <label className="grid gap-1">Cara menentukan penerima
            <select value={method} onChange={(event) => setMethod(event.target.value)} className={control}>
              <option value="DRAW">Undian tiap putaran</option><option value="FIXED">Urutan tetap</option>
            </select>
          </label>
          {method === "FIXED" && (
            <ol className="space-y-2">
              {ordered.map((id, index) => (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  <span>{index + 1}. {memberNames.get(id)}</span>
                  {index > 0 && <button type="button" className={button} onClick={() => {
                    const next = [...ordered];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    setOrder(next);
                  }}>Naikkan {memberNames.get(id)}</button>}
                </li>
              ))}
            </ol>
          )}
          <button className={button} disabled={busy || members.length < 2}>Mulai siklus</button>
          {members.length < 2 && <p>Butuh minimal dua peserta untuk memulai.</p>}
        </form>
      )}
      {history?.rounds.map((round) => (
        <article key={round.id} className="space-y-3 rounded-xl border border-line bg-canvas p-3 sm:p-4">
          <h5 className="font-bold">Putaran {round.number} · {status[round.status]}</h5>
          <p>Jatuh tempo {round.dueDate} · Penerima {round.recipientName ?? "belum ditentukan"}</p>
          <p>Total iuran {currency.format(round.obligations.reduce((total, item) => total + BigInt(item.amount), BigInt(0)))}</p>
          {treasurer && !round.recipientId && ["OPEN", "COLLECTED"].includes(round.status) &&
            <button className={button} disabled={busy} onClick={() => void mutate(`/rounds/${round.id}/draw`)}>Undi penerima</button>}
          {treasurer && round.status === "COLLECTED" && round.recipientId &&
            <button className={button} disabled={busy} onClick={() => {
              if (window.confirm("Dana sudah diserahkan kepada penerima?")) void mutate(`/rounds/${round.id}/payout`, {}, true);
            }}>Catat pencairan</button>}
          {treasurer && round.status === "PAID_OUT" &&
            <button className={button} disabled={busy} onClick={() => void mutate(`/rounds/${round.id}/close`)}>Tutup putaran</button>}
          <ul className="space-y-2">
            {round.obligations.map((item) => (
              <li key={item.id} className="space-y-1 border-t border-stone-200 pt-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="break-words">{item.name} · {currency.format(BigInt(item.amount))}</p>
                  <StatusLabel status={item.claimStatus}>{item.claimStatus ? status[item.claimStatus] : "Belum ada klaim"}</StatusLabel>
                </div>
                {item.note && <p className="break-words text-sm text-stone-700">{item.note}</p>}
                {round.status === "OPEN" && item.memberId === userID &&
                  (!item.claimStatus || item.claimStatus === "REJECTED") && (
                  <form className="grid gap-2" onSubmit={(event) => {
                    event.preventDefault();
                    const note = new FormData(event.currentTarget).get("note");
                    void mutate(`/obligations/${item.id}/claims`, { note });
                  }}>
                    <input name="note" aria-label="Catatan pembayaran" placeholder="Catatan pembayaran (opsional)" maxLength={500} className={control} />
                    <button className={button} disabled={busy}>Saya sudah bayar</button>
                  </form>
                )}
                {treasurer && round.status === "OPEN" && isOverdue(round.dueDate) &&
                  (!item.claimStatus || item.claimStatus === "REJECTED") && (
                  <a className="inline-flex min-h-11 items-center underline"
                    href={paymentNudge(group.name, item.name, item.amount, round.dueDate)} target="_blank" rel="noreferrer">
                    Ingatkan {item.name} lewat WhatsApp<span className="sr-only"> (tab baru)</span>
                  </a>
                )}
                {treasurer && item.claimId && item.claimStatus === "PENDING" &&
                  <div className="flex flex-wrap gap-2">
                    <button className={button} disabled={busy} onClick={() => void mutate(`/claims/${item.claimId}/confirm`, {}, true)}>Konfirmasi</button>
                    <button className={button} disabled={busy} onClick={() => void mutate(`/claims/${item.claimId}/reject`)}>Tolak</button>
                  </div>}
              </li>
            ))}
          </ul>
        </article>
      ))}
      {audit.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer">Riwayat tindakan</summary>
          <ul className="space-y-2">
            {audit.map((entry) => (
              <li key={entry.id}>
                <p>{entry.actor} · {actions[entry.action] ?? entry.action} · {new Date(entry.createdAt).toLocaleString("id-ID")}</p>
                {entry.details.candidates && <p>Kandidat {entry.details.candidates.map((id) => memberNames.get(id) ?? id).join(", ")}. Penerima {memberNames.get(entry.details.recipientId ?? "") ?? entry.details.recipientId}.</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
