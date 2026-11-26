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

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-5 py-8">
      <Brand />
      <div className="panel space-y-5 border-t-2 border-t-gold">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
        {registered && <p role="status" className="rounded-lg bg-success-soft p-3 text-brand">Akun sudah dibuat. Silakan masuk.</p>}
        <form onSubmit={submit} className="grid gap-4">
          {register && (
            <label className="grid gap-1">
              Nama
              <input name="name" autoComplete="name" required maxLength={100}
                className="field" />
            </label>
          )}
          <label className="grid gap-1">
            Email
            <input name="email" type="email" autoComplete="email" required maxLength={254}
              className="field" />
          </label>
          <label className="grid gap-1">
            Kata sandi
            <input id="account-password" name="password" type={showPassword ? "text" : "password"} aria-describedby={register ? "password-help" : undefined} autoComplete={register ? "new-password" : "current-password"}
              required minLength={register ? 12 : undefined} maxLength={128}
              className="field" />
          </label>
          {register && <p id="password-help" className="text-sm text-muted">Gunakan minimal 12 karakter.</p>}
          <button type="button" aria-controls="account-password" onClick={() => setShowPassword(!showPassword)} className="action justify-self-start">
            {showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
          </button>
          {error && <p role="alert" className="notice-error">{error}</p>}
          <button disabled={pending} className="action-primary">
            {pending ? "Memproses…" : heading}
          </button>
        </form>
        <Link href={register ? "/masuk" : "/daftar"} className="flex min-h-11 items-center self-start text-brand underline">
          {register ? "Sudah punya akun? Masuk" : "Belum punya akun? Daftar"}
        </Link>
      </div>
    </main>
  );
}
