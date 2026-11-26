"use client";

import Link from "next/link";
import JoinShell from "./join-shell";
import { useState } from "react";
import type { FormEvent } from "react";

export default function JoinPage() {
  const [notice, setNotice] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get("code");
    const code = String(input || "").trim() || window.location.hash.slice(1);
    setNotice("");
    setNeedsSignIn(false);
    if (!code) { setNotice("Masukkan kode undangan."); return; }
    setPending(true);
    try {
      const post = (path: string, payload: object) => fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let response = await post("/api/v1/groups/join", { code });
      if (response.status === 401) {
        const refresh = await post("/api/v1/auth/refresh", {});
        if (refresh.ok) response = await post("/api/v1/groups/join", { code });
      }
      if (response.ok) {
        const group: { id: string } = await response.json();
        window.location.replace(`/kelompok/${encodeURIComponent(group.id)}`);
        return;
      }
      setNeedsSignIn(response.status === 401);
      setNotice(response.status === 401 ? "Masuk terlebih dahulu, lalu buka kembali tautan ini atau masukkan kodenya." :
        response.status === 410 ? "Undangan kedaluwarsa atau kuotanya sudah habis." :
        "Undangan tidak dapat digunakan. Periksa kodenya.");
    } catch {
      setNotice("Tidak dapat terhubung. Coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <JoinShell>
      <h1 className="text-balance text-4xl font-bold leading-none tracking-[-.055em] sm:text-5xl">
        Gabung kelompok<span aria-hidden="true" className="text-gold">.</span>
      </h1>
      <p id="invite-help" className="mt-4 text-muted">Masukkan kode dari pengurus. Jika kamu membuka tautan undangan, langsung pilih Gabung.</p>
      <form onSubmit={submit} aria-busy={pending} className="mt-6 grid gap-3">
        <label className="grid gap-2 text-sm font-semibold">Kode undangan
          <input name="code" maxLength={32} autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder="Tempel kode undangan" aria-describedby={notice ? "invite-help invite-error" : "invite-help"}
            className="account-field font-mono" />
        </label>
        {notice && <p id="invite-error" role="alert" className="notice-error">{notice}</p>}
        <button disabled={pending} className="action-gold account-submit">{pending ? "Menghubungkan…" : "Gabung"}</button>
      </form>
      {needsSignIn && (
        <Link href="/masuk" target="_blank" rel="noopener" className="account-register mt-4">Masuk di tab baru</Link>
      )}
    </JoinShell>
  );
}
