"use client";

import { useEffect, useState } from "react";
import { PageSkeleton } from "../skeleton";
import AuthForm, { postAuth } from "../auth-form";

let recovery: Promise<boolean> | undefined;

export default function SessionRecovery() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    recovery ??= postAuth("refresh")
      .then(async (response) => {
        if (response.ok) return true;
        // A different tab may already have rotated the refresh cookie.
        return (await fetch("/api/v1/auth/me", { cache: "no-store" })).ok;
      })
      .catch(() => false)
      .finally(() => { recovery = undefined; });

    void recovery.then((restored) => {
      if (!active) return;
      if (restored) window.location.replace("/dasbor");
      else setDone(true);
    });
    return () => { active = false; };
  }, []);

  if (done) return <AuthForm />;
  return <PageSkeleton label="Memeriksa sesi…" />;
}
