import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <h1 className="text-4xl font-semibold tracking-tight">Arisanly</h1>
      <p className="mt-3 text-lg text-stone-700">
        Arisan dan kas kelompok, tercatat rapi dan transparan.
      </p>
      <nav aria-label="Akun" className="mt-6 flex flex-wrap gap-3">
        <Link href="/masuk" className="flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-white">Masuk</Link>
        <Link href="/daftar" className="flex min-h-11 items-center rounded-lg border border-stone-400 px-4">Daftar</Link>
      </nav>
    </main>
  );
}
