"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Arisan from "./arisan";
import Reports from "./reports";
import DashboardIcon from "./dashboard-icon";
import { groupRequest, roles, type Group, type Member } from "./group-api";

const control = "field";
const button = "action";

export default function GroupWorkspace({ group, initialMembers, userID }: {
  group: Group;
  initialMembers: Member[];
  userID: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(group);
  const [members, setMembers] = useState(initialMembers);
  const [invite, setInvite] = useState<{ code: string; link: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try { await action(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "Permintaan gagal."); }
    finally { setBusy(false); }
  }

  function createInvite(event: FormEvent<HTMLFormElement>, group: Group) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      const result = await groupRequest(`/${group.id}/invites`, "POST", { maxUses: Number(data.get("uses")) });
      const link = new URL("/gabung", window.location.origin);
      link.hash = result.code;
      setInvite({ code: result.code, link: link.toString() });
    });
  }

  return (
    <section className="min-w-0 space-y-5">
      <header className="dashboard-masthead relative isolate overflow-hidden border-b border-line pb-6 pt-3 sm:pb-10">
        <div className="dashboard-ledger-art" aria-hidden="true" />
        <p className="relative flex items-center gap-2 text-sm font-semibold text-attention">
          <DashboardIcon name={selected.type === "KAS" ? "cash" : "group"} />
          {selected.type === "KAS" ? "Kas" : "Arisan"} · {roles[selected.role]}
        </p>
        <h1 className="relative mt-2 break-words text-4xl font-bold tracking-[-.055em] sm:text-6xl">{selected.name}</h1>
        <p className="relative mt-2 text-sm text-muted">{members.length} anggota</p>
      </header>
      <nav aria-label="Bagian kelompok" className="flex flex-wrap gap-x-5 border-b border-line">
        {selected.type === "ARISAN" && <a href="#putaran" className="dashboard-link text-sm">Putaran</a>}
        <a href="#laporan" className="dashboard-link text-sm">{selected.type === "KAS" ? "Kas dan laporan" : "Laporan"}</a>
        <a href="#anggota" className="dashboard-link text-sm">Anggota</a>
      </nav>
      {error && <p role="alert" className="notice-error">{error}</p>}
      {selected.role === "OWNER" && (
        <details className="dashboard-glass">
          <summary className="min-h-11 py-2 font-semibold">Pengaturan dan undangan</summary>
          <div className="space-y-3">
            <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
              event.preventDefault();
              const name = new FormData(event.currentTarget).get("name");
              void run(async () => {
                await groupRequest(`/${selected.id}`, "PATCH", { name });
                const updated = await groupRequest(`/${selected.id}`);
                setSelected(updated);
              });
            }}>
              <input key={selected.id} aria-label="Nama baru kelompok" name="name" placeholder="Nama kelompok" defaultValue={selected.name} required maxLength={100} className={control} />
              <button disabled={busy} className={button}>Simpan nama</button>
            </form>
            <form onSubmit={(event) => createInvite(event, selected)} className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1">Kuota undangan<input name="uses" type="number" min={1} max={100} defaultValue={10} required className={control} /></label>
              <button disabled={busy} className={button}>Buat undangan</button>
            </form>
            {invite && <div className="space-y-2">
              <label className="grid gap-1">Tautan undangan (berlaku 7 hari)
                <input readOnly value={invite.link} className={control} onFocus={(event) => event.currentTarget.select()} />
              </label>
              <p className="break-all">Kode <code>{invite.code}</code></p>
              <a className="inline-flex min-h-11 items-center underline" href={`https://wa.me/?text=${encodeURIComponent(invite.link)}`} target="_blank" rel="noreferrer">Bagikan lewat WhatsApp</a>
            </div>}
          </div>
        </details>
      )}
      {selected.type === "ARISAN" && (
        <div id="putaran" className="scroll-mt-4">
          <Arisan group={selected} members={members} userID={userID} request={groupRequest} />
        </div>
      )}
      <div id="laporan" className="scroll-mt-4">
        <Reports group={selected} request={groupRequest} />
      </div>
      <h2 id="anggota" className="scroll-mt-4 text-xl font-bold tracking-tight">Anggota</h2>
      <ul className="space-y-2">
        {members.map((member) => <li key={member.id} className="flex flex-wrap items-center gap-2">
          <span>{member.name} · {roles[member.role]}</span>
          {member.role !== "OWNER" && selected.role === "OWNER" &&
            <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
              await groupRequest(`/${selected.id}/members/${member.id}`, "PATCH", {
                role: member.role === "MEMBER" ? "TREASURER" : "MEMBER",
              });
              setMembers(await groupRequest(`/${selected.id}/members`));
            })}>{member.role === "MEMBER" ? "Jadikan bendahara" : "Jadikan anggota"}</button>}
          {member.role !== "OWNER" && (selected.role === "OWNER" || member.id === userID) &&
            <button type="button" className={button} disabled={busy} onClick={() => {
              if (!window.confirm(member.id === userID ? "Keluar dari kelompok?" : `Keluarkan ${member.name}?`)) return;
              void run(async () => {
                await groupRequest(`/${selected.id}/members/${member.id}`, "DELETE");
                if (member.id === userID) {
                  router.replace("/dasbor#kelompok");
                } else setMembers(await groupRequest(`/${selected.id}/members`));
              });
            }}>{member.id === userID ? "Keluar dari kelompok" : "Keluarkan"}</button>}
        </li>)}
      </ul>
    </section>
  );
}
