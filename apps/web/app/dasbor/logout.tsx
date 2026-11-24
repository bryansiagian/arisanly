"use client";

import { useState } from "react";
import { postAuth } from "../auth-form";

export default function Logout() {
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    setError(false);
    try {
      const response = await postAuth("logout");
      if (!response.ok) throw new Error("Logout failed");
      window.location.replace("/masuk");
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div className="mt-6">
      <button type="button" onClick={logout} disabled={pending}
        className="min-h-11 rounded-lg border border-stone-400 px-4 disabled:opacity-60">
        {pending ? "Memproses…" : "Keluar"}
      </button>
      {error && <p role="alert" className="mt-2 text-red-800">Gagal keluar. Coba lagi.</p>}
    </div>
  );
}
