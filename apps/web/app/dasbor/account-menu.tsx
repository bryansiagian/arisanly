"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import Logout from "./logout";
import DashboardIcon from "./dashboard-icon";

export default function AccountMenu({ name, email }: { name: string; email: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase();

  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) {
        menu.current?.removeAttribute("open");
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, []);

  function close() {
    menu.current?.removeAttribute("open");
  }

  return (
    <details ref={menu} className="account-menu group relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          event.preventDefault();
          close();
          trigger.current?.focus();
        }
      }}>
      <summary ref={trigger} className="account-menu-trigger list-none" aria-label="Menu akun">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-deep text-xs font-bold text-white">{initials}</span>
        <span className="hidden max-w-40 truncate sm:block">{name}</span>
        <svg viewBox="0 0 16 16" className="size-4 text-attention group-open:rotate-180 motion-safe:transition-transform" aria-hidden="true">
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="account-menu-panel absolute top-full right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-line p-2">
        <div className="border-b border-line px-3 py-2">
          <p className="break-words font-bold">{name}</p>
          <p className="break-all text-xs text-muted">{email}</p>
        </div>
        <nav aria-label="Menu akun" className="mt-1">
          <Link href="/dasbor#kelompok" onClick={close} className="account-menu-item">
            <DashboardIcon name="group" className="size-4 text-attention" /> Kelompok
          </Link>
          <Link href="/dasbor#pengingat" onClick={close} className="account-menu-item">
            <DashboardIcon name="bell" className="size-4 text-attention" /> Pengingat
          </Link>
          <Link href="/profil" onClick={close} className="account-menu-item">
            <DashboardIcon name="person" className="size-4 text-attention" /> Profil saya
          </Link>
        </nav>
        <div className="mt-1 border-t border-line pt-1"><Logout /></div>
      </div>
    </details>
  );
}
