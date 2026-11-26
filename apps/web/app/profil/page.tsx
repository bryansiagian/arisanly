import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Brand from "../brand";
import AccountMenu from "../dasbor/account-menu";
import DashboardIcon from "../dasbor/dashboard-icon";
import { authAPI } from "../../lib/auth-api";
import ProfileForm from "./profile-form";

export default async function ProfilePage() {
  const access = (await cookies()).get("arisanly_access");
  if (!access?.value) redirect("/masuk?sesi=1");
  const response = await authAPI("me", {
    headers: { Cookie: `arisanly_access=${encodeURIComponent(access.value)}` },
  });
  if (response.status === 401) redirect("/masuk?sesi=1");
  if (!response.ok) throw new Error("Gagal memuat profil");
  const user: { name: string; email: string } = await response.json();

  return (
    <div className="dashboard mx-auto max-w-5xl px-4 sm:px-8">
      <header className="dashboard-nav flex items-center justify-between gap-3 border-b border-line py-3">
        <Brand />
        <AccountMenu name={user.name} email={user.email} />
      </header>
      <main className="py-7 sm:py-10">
        <header className="dashboard-masthead relative isolate overflow-hidden border-b border-line pb-6 sm:pb-10">
          <div className="dashboard-ledger-art" aria-hidden="true" />
          <div className="relative">
            <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-attention/25 bg-attention-soft text-attention">
              <DashboardIcon name="person" className="size-6" />
            </div>
            <h1 className="text-5xl font-bold leading-none tracking-[-.065em] sm:text-6xl">
              Profil saya<span aria-hidden="true" className="text-gold">.</span>
            </h1>
            <p className="mt-3 max-w-md text-muted">Kelola nama yang dilihat anggota kelompok dan email yang kamu pakai untuk masuk.</p>
          </div>
        </header>
        <div className="dashboard-workspace mt-5 max-w-xl">
          <ProfileForm name={user.name} email={user.email} />
        </div>
      </main>
    </div>
  );
}
