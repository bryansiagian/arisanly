"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Group = { id: string; name: string; type: "ARISAN" | "KAS"; role: string };
type Member = { id: string; name: string; role: string };
const roles: Record<string, string> = { OWNER: "Pemilik", TREASURER: "Bendahara", MEMBER: "Anggota" };

export async function groupRequest(path = "", method = "GET", payload?: object) {
  const response = await fetch(`/api/v1/groups${path}`, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });
  if (response.status === 401) {
    window.location.replace("/masuk?sesi=1");
    throw new Error("Sesi perlu diperbarui. Silakan ulangi tindakanmu.");
  }
  if (!response.ok) {
    if (response.status === 410) throw new Error("Undangan kedaluwarsa atau kuotanya sudah habis.");
    if (response.status === 404) throw new Error("Kelompok atau undangan tidak ditemukan.");
    if (response.status === 403) throw new Error("Kamu tidak memiliki izin untuk melakukan tindakan ini.");
    throw new Error("Permintaan gagal. Periksa input dan coba lagi.");
  }
  return response.status === 204 ? undefined : response.json();
}

const control = "min-h-11 rounded-lg border border-stone-400 bg-white px-3";
const button = "min-h-11 rounded-lg border border-stone-400 px-3 disabled:opacity-50";

export default function Groups({ userID }: { userID: string }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [selected, setSelected] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invite, setInvite] = useState<{ code: string; link: string } | null>(null);
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

  async function open(group: Group) {
    const items = await groupRequest(`/${group.id}/members`);
    if (selected?.id !== group.id) setInvite(null);
    setMembers(items);
    setSelected(group);
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const group = await groupRequest("", "POST", { name: data.get("name"), type: data.get("type") });
      setGroups((items) => [group, ...(items ?? [])]);
      form.reset();
      await open(group);
    });
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
    <section className="mt-8 space-y-5" aria-labelledby="groups-heading">
      <h2 id="groups-heading" className="text-xl font-semibold">Kelompok saya</h2>
      <form onSubmit={create} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input aria-label="Nama kelompok" name="name" placeholder="Nama kelompok" required maxLength={100} className={control} />
        <select aria-label="Jenis kelompok" name="type" className={control}><option value="ARISAN">Arisan</option><option value="KAS">Kas</option></select>
        <button disabled={busy || groups === null} className={button}>Buat kelompok</button>
      </form>
      <a href="/gabung" className="inline-flex min-h-11 items-center underline">Gabung dengan kode</a>
      {error && <p role="alert" className="text-red-800">{error}</p>}
      {groups === null ? <p role="status">Memuat kelompok…</p> : groups.length === 0 ? <p>Belum ada kelompok.</p> : (
        <ul className="space-y-2">
          {groups.map((group) => <li key={group.id}>
            <button type="button" disabled={busy} aria-pressed={selected?.id === group.id}
              className={`${button} w-full text-left`} onClick={() => void run(() => open(group))}>
              {group.name} · {group.type === "KAS" ? "Kas" : "Arisan"} · {roles[group.role]}
            </button>
          </li>)}
        </ul>
      )}
      {selected && (
        <section className="space-y-3 rounded-lg border border-stone-300 p-4">
          <h3 className="font-semibold">{selected.name}</h3>
          {selected.role === "OWNER" && (
            <>
              <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
                event.preventDefault();
                const name = new FormData(event.currentTarget).get("name");
                void run(async () => {
                  await groupRequest(`/${selected.id}`, "PATCH", { name });
                  const updated = await groupRequest(`/${selected.id}`);
                  setSelected(updated);
                  setGroups((items) => items?.map((item) => item.id === updated.id ? updated : item) ?? []);
                });
              }}>
                <input key={selected.id} aria-label="Nama baru kelompok" name="name" defaultValue={selected.name} required maxLength={100} className={control} />
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
            </>
          )}
          <h4 className="font-medium">Anggota</h4>
          <ul className="space-y-2">
            {members.map((member) => <li key={member.id} className="flex flex-wrap items-center gap-2">
              <span>{member.name} · {roles[member.role]}</span>
              {member.role !== "OWNER" && selected.role === "OWNER" &&
                <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
                  await groupRequest(`/${selected.id}/members/${member.id}`, "PATCH", {
                    role: member.role === "MEMBER" ? "TREASURER" : "MEMBER",
                  });
                  await open(selected);
                })}>{member.role === "MEMBER" ? "Jadikan bendahara" : "Jadikan anggota"}</button>}
              {member.role !== "OWNER" && (selected.role === "OWNER" || member.id === userID) &&
                <button type="button" className={button} disabled={busy} onClick={() => {
                  if (!window.confirm(member.id === userID ? "Keluar dari kelompok?" : `Keluarkan ${member.name}?`)) return;
                  void run(async () => {
                    await groupRequest(`/${selected.id}/members/${member.id}`, "DELETE");
                    if (member.id === userID) {
                      setGroups((items) => items?.filter((item) => item.id !== selected.id) ?? []);
                      setSelected(null);
                      setInvite(null);
                    } else await open(selected);
                  });
                }}>{member.id === userID ? "Keluar dari kelompok" : "Keluarkan"}</button>}
            </li>)}
          </ul>
        </section>
      )}
    </section>
  );
}
