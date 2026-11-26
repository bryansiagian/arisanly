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
    <div>
      <button type="button" onClick={logout} disabled={pending}
        className="action">
        {pending ? "Memproses…" : "Keluar"}
      </button>
      {error && <p role="alert" className="notice-error mt-2">Gagal keluar. Coba lagi.</p>}
    </div>
  );
}
