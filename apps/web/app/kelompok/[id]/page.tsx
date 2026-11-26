import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import AccountMenu from "../../dasbor/account-menu";
import Brand from "../../brand";
import { SkeletonRows } from "../../skeleton";
import GroupWorkspace from "../../dasbor/group-workspace";
import type { Group, Member } from "../../dasbor/group-api";
import { authAPI, internalAPI } from "../../../lib/auth-api";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = (await cookies()).get("arisanly_access");
  if (!access?.value) redirect("/masuk?sesi=1");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const headers = { Cookie: `arisanly_access=${encodeURIComponent(access.value)}` };
  const [session, detail] = await Promise.all([
    authAPI("me", { headers }),
    internalAPI(`/api/v1/groups/${id}`, { headers }),
  ]);
  if (session.status === 401 || detail.status === 401) redirect("/masuk?sesi=1");
  if (!session.ok) throw new Error("Gagal memeriksa sesi");
  if (detail.status === 404 || detail.status === 403) notFound();
  if (!detail.ok) throw new Error("Gagal memuat kelompok");
  const [user, group]: [{ id: string; name: string; email: string }, Group] = await Promise.all([session.json(), detail.json()]);

  return (
    <div className="dashboard mx-auto max-w-5xl px-4 sm:px-8">
      <header className="dashboard-nav dashboard-nav-blended flex flex-wrap items-center justify-between gap-2 py-3">
        <Brand />
        <AccountMenu name={user.name} email={user.email} />
      </header>
      <main className="py-6 sm:py-9">
        <Link href="/dasbor#kelompok" className="dashboard-link mb-2 text-sm">Kembali ke kelompok</Link>
        <Suspense fallback={<SkeletonRows label="Memuat anggota dan aktivitas…" />}>
          <Workspace group={group} headers={headers} userID={user.id} />
        </Suspense>
      </main>
    </div>
  );
}

async function Workspace({ group, headers, userID }: { group: Group; headers: HeadersInit; userID: string }) {
  const response = await internalAPI(`/api/v1/groups/${group.id}/members`, { headers });
  if (response.status === 401) redirect("/masuk?sesi=1");
  if (response.status === 403 || response.status === 404) notFound();
  if (!response.ok) throw new Error("Gagal memuat anggota kelompok");
  const members: Member[] = await response.json();
  return <GroupWorkspace group={group} initialMembers={members} userID={userID} />;
}
