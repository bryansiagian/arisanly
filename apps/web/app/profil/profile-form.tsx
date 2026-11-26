"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PasswordField } from "../auth-form";

const errors: Record<string, string> = {
  invalid_input: "Periksa nama dan format email.",
  email_already_registered: "Email ini sudah dipakai akun lain.",
  password_required: "Masukkan kata sandi saat ini untuk mengganti email.",
  incorrect_password: "Kata sandi saat ini salah.",
  profile_changed: "Profil sudah berubah di tempat lain. Muat ulang halaman dan coba lagi.",
  try_again: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
};

export default function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState({ name, email });
  const [draft, setDraft] = useState({ name, email });
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const submitLock = useRef(false);
  const emailChanged = draft.email.trim().toLowerCase() !== saved.email;
  const changed = draft.name.trim() !== saved.name || emailChanged;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || submitLock.current) return;
    const currentPassword = emailChanged ? new FormData(event.currentTarget).get("currentPassword") : undefined;
    submitLock.current = true;
    setPending(true);
    setResult(null);
    try {
      const response = await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, currentPassword }),
      });
      if (response.status === 401) {
        window.location.replace("/masuk?sesi=1");
        return;
      }
      if (!response.ok) {
        const data = await response.json();
        setResult({ ok: false, message: errors[data.error] ?? "Profil belum tersimpan. Coba lagi." });
        return;
      }
      const updated = await response.json() as { name: string; email: string };
      setSaved({ name: updated.name, email: updated.email });
      setDraft({ name: updated.name, email: updated.email });
      setResult({ ok: true, message: emailChanged ? "Profil disimpan. Gunakan email baru saat masuk berikutnya." : "Profil berhasil disimpan." });
      router.refresh();
    } catch {
      setResult({ ok: false, message: "Tidak dapat terhubung. Coba lagi." });
    } finally {
      submitLock.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="dashboard-glass grid gap-4 border-t-2 border-t-gold" aria-busy={pending}>
      <h2 className="text-xl font-bold tracking-tight">Data pribadi</h2>
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <label className="grid gap-2 text-sm font-semibold">
          Nama tampilan
          <input name="name" autoComplete="name" placeholder="Contoh: Rani Putri" required maxLength={100}
            className="account-field" value={draft.name}
            onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setResult(null); }} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Email
          <input name="email" type="email" autoComplete="email" placeholder="nama@contoh.com" required maxLength={254}
            className="account-field" value={draft.email}
            onChange={(event) => { setDraft({ ...draft, email: event.target.value }); setResult(null); }} />
        </label>
        {emailChanged && (
          <PasswordField id="profile-current-password" name="currentPassword" label="Kata sandi saat ini"
            placeholder="Masukkan kata sandi saat ini" autoComplete="current-password" minLength={12}
            hint="Diperlukan untuk mengganti email masuk." />
        )}
      </fieldset>
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "rounded-lg bg-success-soft p-3 text-brand" : "notice-error"}>{result.message}</p>}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button disabled={pending || !changed} className="action-gold disabled:opacity-60">
          {pending ? "Menyimpan…" : "Simpan perubahan"}
        </button>
        {changed && <button type="button" className="action" disabled={pending} onClick={() => {
          setDraft(saved);
          setResult(null);
        }}>Batalkan</button>}
      </div>
    </form>
  );
}
