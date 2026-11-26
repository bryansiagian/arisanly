"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import Brand from "./brand";

const errors: Record<string, string> = {
  invalid_input: "Periksa nama, email, dan kata sandi. Gunakan 12–128 byte untuk kata sandi.",
  invalid_credentials: "Email atau kata sandi salah.",
  email_already_registered: "Email ini sudah terdaftar.",
  try_again: "Terlalu banyak percobaan. Coba lagi sebentar.",
};

export async function postAuth(action: string, payload = {}) {
  return fetch(`/api/v1/auth/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export default function AuthForm({ register = false, registered = false }: {
  register?: boolean;
  registered?: boolean;
}) {
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const heading = register ? "Buat akun" : "Masuk";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      email: form.get("email"),
      password: form.get("password"),
      ...(register ? { name: form.get("name") } : {}),
    };
    setPending(true);
    setError("");
    try {
      const response = await postAuth(register ? "register" : "login", payload);
      if (response.ok) {
        window.location.assign(register ? "/masuk?terdaftar=1" : "/dasbor");
        return;
      }
      const data = await response.json();
      setError(errors[data.error] ?? "Permintaan gagal. Coba lagi.");
    } catch {
      setError("Tidak dapat terhubung. Coba lagi.");
    } finally {
      setPending(false);
    }
  }

  const form = (
    <>
      <header className="mb-6">
        <h1 className={register ? "text-3xl font-bold tracking-tight" : "text-5xl font-bold tracking-[-.065em] sm:text-6xl"}>
          {heading}<span aria-hidden="true" className={register ? "hidden" : "text-gold"}>.</span>
        </h1>
        {!register && <p className="mt-3 text-muted">Masuk untuk membuka dasbor kelompokmu.</p>}
      </header>
      {registered && <p role="status" className="mb-4 rounded-lg bg-success-soft p-3 text-brand">Akun sudah dibuat. Silakan masuk.</p>}
      <form onSubmit={submit} className="grid gap-4" aria-busy={pending}>
        {register && (
          <label className="grid gap-1 font-semibold">
            Nama
            <input name="name" autoComplete="name" required maxLength={100} className="field font-normal" />
          </label>
        )}
        <label className="grid gap-2 text-sm font-semibold">
          Email
          <input name="email" type="email" autoComplete={register ? "email" : "username"} required maxLength={254}
            className="account-field" />
        </label>
        <div className="grid gap-2">
          <label htmlFor="account-password" className="text-sm font-semibold">Kata sandi</label>
          <div className="account-password">
            <input id="account-password" name="password" type={showPassword ? "text" : "password"}
              aria-describedby={register ? "password-help" : undefined}
              autoComplete={register ? "new-password" : "current-password"}
              required minLength={register ? 12 : undefined} maxLength={128} />
            <button type="button" aria-controls="account-password"
              aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
              onClick={() => setShowPassword((visible) => !visible)}
              className="account-password-toggle">
              {showPassword ? "Sembunyikan" : "Lihat"}
            </button>
          </div>
          {register && <p id="password-help" className="text-sm text-muted">Gunakan minimal 12 karakter.</p>}
        </div>
        {error && <p role="alert" className="notice-error">{error}</p>}
        <button disabled={pending} className={register ? "action-primary" : "action-gold account-submit"}>
          {pending ? "Memproses…" : heading}
        </button>
      </form>
      {register ? (
        <Link href="/masuk" className="mt-4 flex min-h-11 items-center text-brand underline">Sudah punya akun? Masuk</Link>
      ) : (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <span className="text-sm text-muted">Belum punya akun?</span>
          <Link href="/daftar" className="account-register">Daftar sekarang</Link>
        </div>
      )}
    </>
  );

  if (!register) return form;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-5 py-8">
      <Brand />
      <div className="panel border-t-2 border-t-gold">{form}</div>
    </main>
  );
}
