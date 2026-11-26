import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import Brand from "../brand";

export default function JoinShell({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard mx-auto max-w-6xl px-4 sm:px-8">
      <header className="dashboard-nav flex flex-wrap items-center justify-between gap-2 border-b border-line py-3">
        <Brand />
        <Link href="/dasbor#kelompok" className="dashboard-link text-sm">Kembali ke dasbor</Link>
      </header>
      <main className="dashboard-workspace grid items-center gap-6 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-10 md:py-14">
        <div className="relative hidden aspect-[1.17] overflow-hidden rounded-[1.75rem] border border-brand-deep bg-brand-deep md:block">
          <Image src="/arisan-invitation.svg" fill sizes="(min-width: 1280px) 550px, 50vw" alt="" className="object-cover" />
        </div>
        <section className="dashboard-glass border-t-2 border-t-gold px-5 py-6 sm:px-7 sm:py-8">
          {children}
        </section>
      </main>
    </div>
  );
}
