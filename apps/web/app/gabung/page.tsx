"use client";

import Link from "next/link";
import Brand from "../brand";
import { useState } from "react";
import type { FormEvent } from "react";

export default function JoinPage() {
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get("code");
    const code = String(input || "").trim() || window.location.hash.slice(1);
    setNotice("");
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
      if (response.ok) { window.location.replace("/dasbor"); return; }
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
    <main className="mx-auto max-w-lg space-y-5 px-5 py-10">
      <Brand />
      <div className="panel space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Gabung kelompok</h1>
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1">Kode undangan
            <input name="code" maxLength={32} autoComplete="off" aria-describedby="invite-help" className="field" />
          </label>
          <p id="invite-help" className="text-sm text-muted">Jika membuka tautan undangan, kamu bisa langsung memilih Gabung.</p>
          <button disabled={pending} className="action-primary">{pending ? "Memproses…" : "Gabung"}</button>
        </form>
        {notice && <p role="alert" className="notice-error">{notice}</p>}
        <Link href="/masuk" target="_blank" rel="noopener" className="inline-flex min-h-11 items-center underline">Masuk di tab baru</Link>
      </div>
    </main>
  );
}
