import Image from "next/image";
import Link from "next/link";
import Brand from "./brand";

const steps = [
  ["Bentuk kelompok", "Buat kelompok Arisan atau Kas, lalu bagikan tautan undangan."],
  ["Catat iuran", "Anggota mengajukan klaim. Bendahara memeriksa dan mengonfirmasi pembayaran yang diterima."],
  ["Lihat hasilnya", "Cek progres putaran, saldo, dan riwayat. Unduh laporan CSV saat perlu rekap."],
];

export default function Home() {
  return (
    <div className="mx-auto max-w-[1440px] px-5 sm:px-9 lg:px-14">
      <div className="flex flex-col lg:min-h-svh">
        <header className="flex items-center justify-between gap-3 border-b border-line py-4">
          <Brand />
          <nav aria-label="Navigasi utama" className="flex items-center gap-5">
            <a href="#cara-kerja" className="hidden min-h-11 items-center text-sm font-semibold sm:inline-flex">Cara kerja</a>
            <Link href="/masuk" className="action">Masuk <span aria-hidden="true" className="ml-2">↗</span></Link>
          </nav>
        </header>
        <main id="konten" className="hero-intro grid flex-1 items-center gap-9 py-9 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12">
          <div>
            <h1 className="text-balance text-[clamp(2.85rem,6vw,6.4rem)] leading-[.96] font-bold tracking-[-.075em]">
              Uang bersama<span className="text-amber-600">.</span><br />
              Catatan <span className="hero-highlight">jelas.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
              Kelola iuran, putaran arisan, dan kas kelompok dalam satu dasbor yang bisa dilihat semua anggota.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/daftar" className="action-gold">Buat akun <span aria-hidden="true">↗</span></Link>
              <a href="#cara-kerja" className="action">Lihat cara kerja</a>
            </div>
          </div>
          <figure className="hero-art relative isolate aspect-[1.05] min-w-0 overflow-hidden rounded-[1.75rem] border border-[#5f6747] bg-[#172821] shadow-xl sm:aspect-[1.22] lg:aspect-[1.12]">
            <Image src="/arisan-cycle.svg" fill preload sizes="(min-width: 1024px) 50vw, 100vw" alt="" className="object-cover" />
            <figcaption className="absolute top-4 left-4 rounded-full border border-white/20 bg-neutral-950/50 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md sm:top-6 sm:left-6">
              Contoh putaran arisan
            </figcaption>
            <div className="hero-glass absolute right-3 bottom-3 left-3 rounded-2xl p-3.5 sm:right-5 sm:bottom-5 sm:left-auto sm:min-w-64 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs text-stone-200">Iuran terkumpul</p><p className="text-2xl font-bold tracking-tight text-white tabular-nums sm:text-3xl">Rp75.000</p></div>
                <span className="rounded-md bg-[#F59E0B] px-2 py-1 text-xs font-bold text-stone-950">3/4 lunas</span>
              </div>
              <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20"><div className="hero-progress h-full w-3/4 rounded-full bg-[#F59E0B]" /></div>
              <p className="mt-2 text-xs text-stone-200">Target Rp100.000 · Penerima Rani</p>
            </div>
          </figure>
        </main>
      </div>
      <section id="cara-kerja" className="scroll-reveal border-t border-line py-14 sm:py-20" aria-labelledby="cara-kerja-title">
        <h2 id="cara-kerja-title" className="text-4xl font-bold tracking-tight sm:text-5xl">Cara kerja Arisanly</h2>
        <ol className="mt-7 grid gap-5 sm:grid-cols-3">
          {steps.map(([title, detail], index) => (
            <li key={title} className="border-t-2 border-gold pt-4">
              <span className="font-mono text-sm font-semibold text-muted">0{index + 1}</span>
              <h3 className="mt-2 text-xl font-bold">{title}</h3>
              <p className="mt-2 max-w-sm leading-relaxed text-muted">{detail}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="scroll-reveal mb-10 grid gap-5 rounded-3xl border border-line bg-white p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-9">
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Siap mulai kelompokmu?</h2>
          <p className="mt-2 text-muted">Pembayaran dan pencairan tetap dilakukan di luar Arisanly. Semua anggota bisa melihat catatannya.</p>
        </div>
        <Link href="/daftar" className="action-gold">Buat akun</Link>
      </section>
      <footer className="border-t border-line py-5"><Brand /></footer>
    </div>
  );
}
