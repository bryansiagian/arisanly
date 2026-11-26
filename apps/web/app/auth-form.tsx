"use client";

import type { FormEvent, Ref } from "react";
import { useEffect, useRef, useState } from "react";
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
  const [email, setEmail] = useState("");
  const [invalidEmail, setInvalidEmail] = useState(false);
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const emailField = useRef<HTMLInputElement>(null);
  const confirmationField = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const heading = register ? "Buat akun" : "Masuk";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInvalidEmail(emailField.current?.validity.typeMismatch ?? false);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [email]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (register && form.get("password") !== form.get("passwordConfirmation")) {
      setError("");
      setPasswordMismatch(true);
      confirmationField.current?.focus();
      return;
    }
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
    <>
      <header className="mb-6">
        <h1 className="text-balance text-5xl font-bold tracking-[-.065em] sm:text-6xl">
          {heading}<span aria-hidden="true" className="text-gold">.</span>
        </h1>
        <p className="mt-3 text-muted">
          {register ? "Gunakan akun ini untuk membuat kelompok atau menerima undangan." : "Masuk untuk membuka dasbor kelompokmu."}
        </p>
      </header>
      {registered && <p role="status" className="mb-4 rounded-lg bg-success-soft p-3 text-brand">Akun sudah dibuat. Silakan masuk.</p>}
      <form onSubmit={submit} className="grid gap-4" aria-busy={pending}>
        {register && (
          <label className="grid gap-2 text-sm font-semibold">
            Nama
            <input name="name" autoComplete="name" placeholder="Contoh: Rani Putri" required maxLength={100} className="account-field" />
          </label>
        )}
        <div className="grid gap-2">
          <label htmlFor="account-email" className="text-sm font-semibold">Email</label>
          <input ref={emailField} id="account-email" name="email" type="email" value={email}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              setInvalidEmail(false);
            }}
            onInvalid={(event) => setInvalidEmail(event.currentTarget.validity.typeMismatch)}
            autoComplete={register ? "email" : "username"} placeholder="nama@contoh.com" required maxLength={254}
            aria-invalid={invalidEmail || undefined} aria-describedby={invalidEmail ? "email-format-help" : undefined}
            className="account-field" />
          <p id="email-format-help" aria-live="polite" className="min-h-5 text-sm leading-5 text-danger">
            {invalidEmail ? "Format email belum valid. Contoh: nama@contoh.com." : ""}
          </p>
        </div>
        <PasswordField
          id="account-password" name="password" label="Kata sandi"
          placeholder={register ? "Buat kata sandi" : "Masukkan kata sandi"}
          autoComplete={register ? "new-password" : "current-password"}
          minLength={register ? 12 : undefined}
          onChange={() => setPasswordMismatch(false)}
          hint={register ? "Gunakan minimal 12 karakter." : undefined}
        />
        {register && (
          <PasswordField
            id="account-password-confirmation" name="passwordConfirmation" label="Konfirmasi kata sandi"
            placeholder="Ketik ulang kata sandi" autoComplete="new-password"
            inputRef={confirmationField} invalid={passwordMismatch}
            hint={passwordMismatch ? "Konfirmasi kata sandi belum sama." : undefined}
            onChange={() => setPasswordMismatch(false)}
          />
        )}
        {error && <p role="alert" className="notice-error">{error}</p>}
        <button disabled={pending} className="action-gold account-submit">
          {pending ? "Memproses…" : heading}
        </button>
      </form>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <span className="text-sm text-muted">{register ? "Sudah punya akun?" : "Belum punya akun?"}</span>
        <Link href={register ? "/masuk" : "/daftar"} className="account-register">
          {register ? "Masuk" : "Daftar sekarang"}
        </Link>
      </div>
    </>
  );
}


function PasswordField({
  id, name, label, placeholder, autoComplete, minLength, hint, invalid, inputRef, onChange,
}: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: string;
  invalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const hintID = `${id}-hint`;
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <div className="account-password" data-invalid={invalid || undefined}>
        <input ref={inputRef} id={id} name={name} type={showPassword ? "text" : "password"}
          aria-describedby={hint ? hintID : undefined} aria-invalid={invalid || undefined}
          autoComplete={autoComplete} placeholder={placeholder}
          required minLength={minLength} maxLength={128} onChange={onChange} />
        <button type="button" aria-controls={id}
          aria-label={`${showPassword ? "Sembunyikan" : "Tampilkan"} ${label.toLowerCase()}`}
          onClick={() => setShowPassword((visible) => !visible)}
          className="account-password-toggle">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className="size-5">
            {showPassword ? (
              <path d="M3 3l18 18M10.6 10.6a2 2 0 1 0 2.8 2.8M9.5 5.5A10 10 0 0 1 12 5c5.2 0 8.6 4.3 10 7a16 16 0 0 1-3.1 3.8M6 6.5A16 16 0 0 0 2 12c1.4 2.7 4.8 7 10 7a10 10 0 0 0 4.5-1.1" />
            ) : (
              <>
                <path d="M2 12c1.4-2.7 4.8-7 10-7s8.6 4.3 10 7c-1.4 2.7-4.8 7-10 7S3.4 14.7 2 12Z" />
                <circle cx="12" cy="12" r="2.5" />
              </>
            )}
          </svg>
        </button>
      </div>
      {hint && <p id={hintID} role={invalid ? "alert" : undefined}
        className={invalid ? "text-sm text-danger" : "text-sm text-muted"}>{hint}</p>}
    </div>
  );
}
