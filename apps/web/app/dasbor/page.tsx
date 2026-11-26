import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authAPI } from "../../lib/auth-api";
import Brand from "../brand";
import Groups from "./groups";
import Logout from "./logout";
import Reminders from "./reminders";

export default async function DashboardPage() {
  const access = (await cookies()).get("arisanly_access");
  if (!access) redirect("/masuk?sesi=1");

  const response = await authAPI("me", {
    headers: { Cookie: `arisanly_access=${encodeURIComponent(access.value)}` },
  });
  if (response.status === 401) redirect("/masuk?sesi=1");
  if (!response.ok) throw new Error("Could not load the signed-in user");

  const user: { id: string; name: string; email: string } = await response.json();
  return (
    <div className="dashboard mx-auto max-w-[1440px] px-4 sm:px-8 lg:px-12">
      <a href="#konten" className="sr-only focus:not-sr-only focus:inline-flex focus:py-3">Lewati ke konten</a>
      <header className="dashboard-nav flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-3">
        <Brand />
        <Logout />
        <nav aria-label="Navigasi dasbor" className="order-last flex w-full flex-wrap items-center gap-x-5 sm:order-none sm:w-auto">
          <a className="dashboard-link" href="#kelompok">Kelompok</a>
          <a className="dashboard-link" href="#pengingat" aria-controls="pengingat">Pengingat</a>
        </nav>
      </header>
      <main id="konten" tabIndex={-1} className="pb-12 pt-5 sm:pt-8">
        <div className="dashboard-masthead relative isolate overflow-hidden border-b border-line py-7 sm:py-11">
          <div className="dashboard-ledger-art" aria-hidden="true" />
          <div className="relative max-w-2xl">
            <p className="mb-2 text-sm font-semibold text-attention">Dasbor</p>
            <h1 className="break-words text-[clamp(2.6rem,7vw,6rem)] font-bold leading-[.98] tracking-[-.065em]">
              Halo, {user.name}<span aria-hidden="true" className="text-gold">.</span>
            </h1>
            <p className="mt-3 break-all text-sm text-muted">{user.email}</p>
          </div>
        </div>
        <div className="dashboard-workspace mt-5 grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-9">
          <Reminders />
          <Groups userID={user.id} />
        </div>
      </main>
    </div>
  );
}
