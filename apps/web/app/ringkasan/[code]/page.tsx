import Brand from "../../brand";
import { notFound } from "next/navigation";
import { internalAPI } from "../../../lib/auth-api";

export const metadata = { title: "Ringkasan Arisanly", robots: { index: false, follow: false } };

export default async function PublicReport({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) notFound();
  const response = await internalAPI(`/api/v1/public/g/${code}`, {});
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Ringkasan gagal dimuat");
  const report: { type: string; balance: string } = await response.json();
  const format = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  return (
    <main className="mx-auto max-w-xl space-y-5 px-5 py-10">
      <Brand />
      <section className="panel space-y-4">
        <h1 className="text-3xl font-semibold">Ringkasan {report.type === "KAS" ? "kas" : "arisan"}</h1>
        <p className="text-muted">Saldo dana <strong className="block text-3xl text-ink tabular-nums">{format.format(BigInt(report.balance))}</strong></p>
      </section>
    </main>
  );
}
