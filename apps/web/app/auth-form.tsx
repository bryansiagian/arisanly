"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <Link href="/" className="self-start font-semibold">Arisanly</Link>
      <h1 className="text-3xl font-semibold">{heading}</h1>
      {registered && <p role="status">Akun sudah dibuat. Silakan masuk.</p>}
      <form onSubmit={submit} className="grid gap-4">
        {register && (
          <label className="grid gap-1">
            Nama
            <input name="name" autoComplete="name" required maxLength={100}
              className="min-h-11 rounded-lg border border-stone-400 bg-white px-3" />
          </label>
        )}
        <label className="grid gap-1">
          Email
          <input name="email" type="email" autoComplete="email" required maxLength={254}
            className="min-h-11 rounded-lg border border-stone-400 bg-white px-3" />
        </label>
        <label className="grid gap-1">
          Kata sandi
          <input name="password" type="password" autoComplete={register ? "new-password" : "current-password"}
            required minLength={register ? 12 : undefined} maxLength={128}
            className="min-h-11 rounded-lg border border-stone-400 bg-white px-3" />
        </label>
        {error && <p role="alert" className="text-red-800">{error}</p>}
        <button disabled={pending} className="min-h-11 rounded-lg bg-stone-900 px-4 font-medium text-white disabled:opacity-60">
          {pending ? "Memproses…" : heading}
        </button>
      </form>
      <Link href={register ? "/masuk" : "/daftar"} className="flex min-h-11 items-center self-start underline">
        {register ? "Sudah punya akun? Masuk" : "Belum punya akun? Daftar"}
      </Link>
    </main>
  );
}
