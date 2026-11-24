import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authAPI } from "../../lib/auth-api";
import Logout from "./logout";

export default async function DashboardPage() {
  const access = (await cookies()).get("arisanly_access");
  if (!access) redirect("/masuk?sesi=1");

  const response = await authAPI("me", {
    headers: { Cookie: `arisanly_access=${encodeURIComponent(access.value)}` },
  });
  if (response.status === 401) redirect("/masuk?sesi=1");
  if (!response.ok) throw new Error("Could not load the signed-in user");

  const user: { name: string; email: string } = await response.json();
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Halo, {user.name}</h1>
      <p className="mt-2 text-stone-700">{user.email}</p>
      <Logout />
    </main>
  );
}
