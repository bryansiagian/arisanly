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
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
        <Brand />
        <Logout />
      </header>
      <main id="konten" className="py-6 sm:py-9">
        <div className="panel border-emerald-200 bg-emerald-50">
          <h1 className="break-words text-3xl font-bold tracking-tight">Halo, {user.name}</h1>
          <p className="mt-1 break-all text-sm text-muted">{user.email}</p>
        </div>
        <Reminders />
        <Groups userID={user.id} />
      </main>
    </div>
  );
}
