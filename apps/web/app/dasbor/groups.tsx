"use client";

import { SkeletonRows } from "../skeleton";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import DashboardIcon from "./dashboard-icon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { groupRequest, roles, type Group } from "./group-api";

const control = "field";
export default function Groups() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void groupRequest().then((items) => {
      if (active) setGroups(items ?? []);
    }).catch((problem: Error) => {
      if (active) { setGroups([]); setError(problem.message); }
    });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try { await action(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "Permintaan gagal."); }
    finally { setBusy(false); }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const group = await groupRequest("", "POST", { name: data.get("name"), type: data.get("type") });
      setGroups((items) => [group, ...(items ?? [])]);
      form.reset();
      setComposerOpen(false);
      router.push(`/kelompok/${group.id}`);
    });
  }

  return (
    <section id="kelompok" className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1" aria-labelledby="groups-heading">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 id="groups-heading" className="text-3xl font-bold tracking-[-.045em] sm:text-4xl">Kelompok saya</h2>
          {groups && <p className="mt-1 text-sm text-muted">{groups.length} kelompok</p>}
        </div>
        <button type="button" className="action-gold" aria-expanded={composerOpen} aria-controls="group-composer"
          onClick={() => setComposerOpen((shown) => !shown)}>
          {composerOpen ? "Tutup formulir" : "Buat kelompok"}
          {!composerOpen && <DashboardIcon name="plus" className="size-4" />}
        </button>
      </div>
      <div id="group-composer" hidden={!composerOpen} className="dashboard-glass">
        <form onSubmit={create} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="grid gap-1 text-sm font-semibold">
            Nama kelompok
            <input name="name" placeholder="Contoh: Arisan keluarga" required maxLength={100} className={control} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Jenis kelompok
            <select name="type" className={control}><option value="ARISAN">Arisan</option><option value="KAS">Kas</option></select>
          </label>
          <button disabled={busy || groups === null} className="action-primary">{busy ? "Menyimpan…" : "Simpan kelompok"}</button>
        </form>
      </div>
      <a href="/gabung" className="dashboard-link text-sm">Gabung dengan kode <DashboardIcon name="arrow" className="size-4" /></a>
      {error && <p role="alert" className="notice-error">{error}</p>}
      {groups === null ? <SkeletonRows label="Memuat kelompok…" rows={3} /> : groups.length === 0 ? <p className="dashboard-glass text-muted">Belum ada kelompok. Buat kelompok atau gunakan kode undangan.</p> : (
        <ul className="divide-y divide-line border-y border-line">
          {groups.map((group) => <li key={group.id}>
            <Link href={`/kelompok/${group.id}`}
              className="dashboard-group-row flex min-h-[4.75rem] w-full items-center gap-3 px-2 py-3 text-left hover:bg-white/70 sm:px-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand">
                <DashboardIcon name={group.type === "KAS" ? "cash" : "group"} />
              </span>
              <span className="min-w-0 flex-1 break-words">
                <span className="block font-bold">{group.name}</span>
                <span className="mt-0.5 block text-sm text-muted">{group.type === "KAS" ? "Kas" : "Arisan"} · {roles[group.role]}</span>
              </span>
              <DashboardIcon name="arrow" className="size-5 shrink-0 text-attention" />
            </Link>
          </li>)}
        </ul>
      )}
    </section>
  );
}
