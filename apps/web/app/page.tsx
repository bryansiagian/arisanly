import Link from "next/link";
import Brand from "./brand";

const features = [
  ["Arisan", "Atur putaran, tentukan penerima, dan konfirmasi pembayaran anggota."],
  ["Kas kelompok", "Catat pemasukan, pengeluaran, dan iuran rutin dalam satu tempat."],
  ["Laporan", "Lihat riwayat transaksi, unduh CSV, atau bagikan ringkasan saldo."],
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
        <Brand />
        <nav aria-label="Akun"><Link href="/masuk" className="action">Masuk</Link></nav>
      </header>
      <main id="konten" className="py-10 sm:py-16">
        <section className="grid items-center gap-8 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
          <div>
            <h1 className="max-w-xl text-balance text-4xl leading-tight font-bold tracking-tight sm:text-6xl">
              Kelola arisan dan kas dalam satu tempat
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
              Lihat siapa yang sudah bayar, siapa penerima berikutnya, dan berapa saldo kelompok.
            </p>
            <Link href="/daftar" className="action-primary mt-6">Buat akun</Link>
          </div>
          <figure className="min-w-0 rounded-3xl bg-brand-deep p-5 text-white sm:p-8">
            <figcaption className="text-sm font-semibold text-emerald-100">Contoh putaran arisan</figcaption>
            <div className="mt-4 rounded-2xl bg-white p-4 text-ink sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="text-sm text-muted">Iuran terkumpul</p><p className="text-3xl font-bold tabular-nums">Rp75.000</p></div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-brand-deep">3 dari 4 lunas</span>
              </div>
              <div aria-hidden="true" className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100"><div className="h-full w-3/4 rounded-full bg-brand" /></div>
              <dl className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <div><dt className="text-sm text-muted">Target iuran</dt><dd className="font-semibold">Rp100.000</dd></div>
                <div><dt className="text-sm text-muted">Penerima putaran</dt><dd className="font-semibold">Rani</dd></div>
              </dl>
            </div>
          </figure>
        </section>
        <section aria-label="Fitur Arisanly" className="mt-10 grid gap-3 sm:grid-cols-3">
          {features.map(([title, description]) => (
            <article key={title} className="panel">
              <h2 className="font-bold">{title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
