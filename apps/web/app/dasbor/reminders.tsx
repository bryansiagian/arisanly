"use client";

import { SkeletonRows } from "../skeleton";

import DashboardIcon from "./dashboard-icon";
import StatusLabel from "../status-label";

import { useEffect, useState } from "react";

type Reminder = {
  id: string;
  groupName: string;
  dueDate: string;
  amount: string;
  stage: "UPCOMING" | "TODAY" | "OVERDUE";
  read: boolean;
};
const labels = { UPCOMING: "Segera jatuh tempo", TODAY: "Jatuh tempo hari ini", OVERDUE: "Lewat jatuh tempo" };
const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

async function inbox(path = "", method = "GET") {
  const response = await fetch("/api/v1/reminders" + path, { method, cache: "no-store" });
  if (response.status === 401) window.location.replace("/masuk?sesi=1");
  if (!response.ok) throw new Error("Pengingat gagal dimuat atau diperbarui. Coba lagi.");
  return response;
}

export default function Reminders() {
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void inbox().then((response) => response.json()).then((data: Reminder[]) => {
      if (active) setItems(data);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  async function refresh() {
    try {
      setError(false);
      setItems(null);
      setItems(await (await inbox()).json());
    } catch { setError(true); }
  }

  async function markRead(id: string) {
    setError(false);
    setPending(id);
    try {
      await inbox(`/${id}/read`, "PATCH");
      setItems((current) => current?.map((item) => item.id === id ? { ...item, read: true } : item) ?? null);
    } catch { setError(true); }
    finally { setPending(""); }
  }

  const unread = items?.filter((item) => !item.read).length;
  return (
    <details id="pengingat" className="dashboard-glass group lg:col-start-2 lg:row-start-1">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
        <DashboardIcon name="bell" className="size-5 shrink-0 text-attention" />
        <span className="flex-1">Pengingat iuran</span>
        {!!unread && <span className="rounded-full bg-attention-soft px-2 py-1 text-xs font-bold text-attention">{unread}<span className="sr-only"> belum dibaca</span></span>}
        <DashboardIcon name="arrow" className="size-4 shrink-0 text-muted group-open:rotate-90 motion-safe:transition-transform" />
      </summary>
      <div className="space-y-2 pb-3">
        {error && <p role="alert" className="notice-error">Pengingat gagal dimuat atau diperbarui.</p>}
        {!items && !error && <SkeletonRows label="Memuat pengingat…" rows={2} />}
        {items?.length === 0 && <p>Belum ada pengingat iuran.</p>}
        <button type="button" onClick={() => void refresh()} className="dashboard-link text-sm">Muat ulang pengingat</button>
        <ul aria-live="polite" className="space-y-2">
          {items?.map((item) => (
            <li key={item.id} className="break-words border-t border-stone-200 pt-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className={item.read ? "" : "font-semibold"}>{item.groupName}</p>
                <StatusLabel status={item.stage}>{labels[item.stage]}</StatusLabel>
              </div>
              <p>{currency.format(BigInt(item.amount))} · {item.dueDate}</p>
              {item.read ? <p className="text-sm text-stone-600">Sudah dibaca</p> :
                <button type="button" disabled={pending !== ""} onClick={() => void markRead(item.id)}
                  className="dashboard-link text-sm">Tandai dibaca<span className="sr-only"> · {item.groupName} · {item.dueDate} · {labels[item.stage]}</span></button>}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
