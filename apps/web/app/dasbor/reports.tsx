"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type Report = {
  month: string;
  summary: {
    balance: string; opening: string; income: string; expenses: string;
    schedule: { amount: string; frequency: string; nextNumber: number; nextDue: string } | null;
    dues: { id: string; name: string; amount: string; dueDate: string; status: string }[];
  };
  rows: { at: string; type: string; category: string; note: string; member: string; amount: string; delta: string }[];
};
type Request = (path: string, method?: string, payload?: object, key?: string) => Promise<unknown>;
const control = "min-h-11 rounded-lg border border-stone-400 bg-white px-3";
const button = "min-h-11 rounded-lg border border-stone-500 px-3 disabled:opacity-50";
const format = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rupiah = (value: string) => format.format(BigInt(value));
const labels: Record<string, string> = {
  CHARGE: "Tagihan", PAYMENT: "Pembayaran iuran", INCOME: "Pemasukan", EXPENSE: "Pengeluaran",
  PAYOUT: "Pencairan", REVERSAL: "Koreksi", PAID: "Lunas", LATE: "Terlambat", OWED: "Belum dibayar",
};

export default function Reports({ group, request }: {
  group: { id: string; type: "ARISAN" | "KAS"; role: string };
  request: Request;
}) {
  const root = `/${group.id}`;
  const kas = group.type === "KAS";
  const treasurer = ["OWNER", "TREASURER"].includes(group.role);
  const [report, setReport] = useState<Report | null>(null);
  const [share, setShare] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [keyStore] = useState(() => new Map<string, string>());

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try { await action(); }
    catch (problem) { setNotice(problem instanceof Error ? problem.message : "Permintaan gagal."); }
    finally { setBusy(false); }
  }

  async function load(month = report?.month ?? "") {
    const query = month ? `?month=${encodeURIComponent(month)}` : "";
    setReport(await request(root + "/summary" + query) as Report);
  }

  function write(path: string, body: object, money = false) {
    void run(async () => {
      const fingerprint = path + JSON.stringify(body);
      const key = money ? keyStore.get(fingerprint) ?? crypto.randomUUID() : undefined;
      if (key) keyStore.set(fingerprint, key);
      await request(root + path, "POST", body, key);
      if (key) keyStore.delete(fingerprint);
      await load();
    });
  }

  function cash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = Number(data.get("amount"));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setNotice("Masukkan nominal rupiah bulat.");
      return;
    }
    write(data.get("type") === "expense" ? "/expenses" : "/income",
      { amount, category: data.get("category"), note: data.get("note") }, true);
  }

  return (
    <section className="space-y-4 border-y border-stone-300 py-4">
      <h4 className="text-lg font-semibold">{kas ? "Kas dan laporan" : "Laporan keuangan"}</h4>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        const month = String(new FormData(event.currentTarget).get("month") ?? "");
        void run(() => load(month));
      }}>
        <label className="grid gap-1">Bulan laporan<input type="month" name="month" className={control} /></label>
        <button disabled={busy} className={button}>Muat laporan</button>
      </form>
      {notice && <p role="alert" className="text-red-800">{notice}</p>}
      {report && <>
        <dl className="grid grid-cols-2 gap-3">
          <div><dt>Saldo saat ini</dt><dd>{rupiah(report.summary.balance)}</dd></div>
          <div><dt>Saldo awal {report.month}</dt><dd>{rupiah(report.summary.opening)}</dd></div>
          <div><dt>Pemasukan bulan ini</dt><dd>{rupiah(report.summary.income)}</dd></div>
          <div><dt>Pengeluaran bulan ini</dt><dd>{rupiah(report.summary.expenses)}</dd></div>
        </dl>
        <a className="inline-flex min-h-11 items-center underline" href={`/api/v1/groups${root}/export.csv?month=${report.month}`}>Unduh CSV {report.month}</a>
        {kas && treasurer && <form onSubmit={cash} className="grid gap-2">
          <label className="grid gap-1">Jenis transaksi<select name="type" className={control}><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></select></label>
          <label className="grid gap-1">Nominal (Rp)<input name="amount" type="number" min="1" step="1" required className={control} /></label>
          <label className="grid gap-1">Kategori<input name="category" maxLength={80} required className={control} /></label>
          <label className="grid gap-1">Catatan<input name="note" maxLength={500} className={control} /></label>
          <button disabled={busy} className={button}>Catat transaksi</button>
        </form>}
        {kas && <section className="space-y-2">
          <h5 className="font-semibold">Iuran kas</h5>
          {report.summary.schedule ? <>
            <p>Iuran {rupiah(report.summary.schedule.amount)} · {report.summary.schedule.frequency === "WEEKLY" ? "mingguan" : "bulanan"}</p>
            <p>Jatuh tempo berikutnya {report.summary.schedule.nextDue}</p>
            {treasurer && <button disabled={busy} className={button} onClick={() =>
              write("/kas/periods", { number: report.summary.schedule?.nextNumber })}>Buat tagihan periode berikutnya</button>}
          </> : treasurer && <form className="grid gap-2" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const amount = Number(data.get("amount"));
            if (!Number.isSafeInteger(amount) || amount <= 0) { setNotice("Masukkan nominal rupiah bulat."); return; }
            write("/kas/schedule", { amount, frequency: data.get("frequency"), firstDue: data.get("firstDue") });
          }}>
            <label className="grid gap-1">Iuran per anggota (Rp)<input name="amount" type="number" min="1" step="1" required className={control} /></label>
            <label className="grid gap-1">Frekuensi<select name="frequency" className={control}><option value="MONTHLY">Bulanan</option><option value="WEEKLY">Mingguan</option></select></label>
            <label className="grid gap-1">Jatuh tempo pertama<input name="firstDue" type="date" required className={control} /></label>
            <button disabled={busy} className={button}>Simpan jadwal iuran</button>
          </form>}
          <ul className="space-y-2">
            {report.summary.dues.map((due) => <li key={due.id} className="border-t border-stone-200 pt-2">
              <p>{due.name} · {due.dueDate} · {rupiah(due.amount)} · {labels[due.status]}</p>
              {treasurer && due.status !== "PAID" && <button disabled={busy} className={button} onClick={() => {
                if (window.confirm(`Pembayaran ${due.name} sudah diterima?`)) write(`/kas/dues/${due.id}/pay`, {}, true);
              }}>Catat pembayaran</button>}
            </li>)}
          </ul>
        </section>}
        <div>
          <h5 className="font-semibold">Riwayat transaksi {report.month}</h5>
          {report.rows.length === 0 && <p>Belum ada transaksi pada bulan ini.</p>}
          <ul className="space-y-2">{report.rows.map((row, index) => (
            <li key={index} className="break-words border-t border-stone-200 py-2">
              <p>{new Date(row.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB · {labels[row.type] ?? row.type} · {rupiah(row.delta === "0" ? row.amount : row.delta)}</p>
              {(row.member || row.category || row.note) && <p>{[row.member, row.category, row.note].filter(Boolean).join(" · ")}</p>}
            </li>
          ))}</ul>
        </div>
      </>}
      {group.role === "OWNER" && <div className="space-y-2">
        <h5 className="font-semibold">Ringkasan publik</h5>
        <p>Tautan menampilkan jenis kelompok dan saldo selama tujuh hari. Tautan lama berhenti berlaku saat diganti.</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} className={button} onClick={() => void run(async () => {
            const issued = await request(root + "/share", "POST", {}) as { code: string };
            setShare(new URL(`/ringkasan/${issued.code}`, window.location.origin).toString());
          })}>Buat tautan publik</button>
          <button disabled={busy} className={button} onClick={() => void run(async () => {
            await request(root + "/share", "DELETE");
            setShare("");
          })}>Cabut tautan</button>
        </div>
        {share && <label className="grid gap-1">Tautan publik<input readOnly value={share} className={control} onFocus={(event) => event.currentTarget.select()} /></label>}
      </div>}
    </section>
  );
}
