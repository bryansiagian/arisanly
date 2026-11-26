import type { ReactNode } from "react";
import Image from "next/image";
import Brand from "./brand";

export default function AccountShell({ children, register = false }: { children: ReactNode; register?: boolean }) {
  return (
    <main className="mx-auto grid min-h-svh max-w-[1500px] items-stretch gap-0 p-4 sm:p-6 lg:grid-cols-[1.04fr_0.96fr]">
      <aside className="relative isolate hidden min-h-[640px] overflow-hidden rounded-[2rem] bg-brand-deep lg:block">
        <Image src={register ? "/arisan-circle.svg" : "/arisan-ledger.svg"} alt="" fill preload sizes="52vw" className="object-cover" />
        <div className="absolute inset-0 bg-linear-to-b from-[#0d201b]/85 via-transparent to-[#0d201b]/75" />
        <div className="absolute inset-x-0 top-0 p-9 xl:p-12">
          <p className="max-w-sm text-balance text-5xl leading-[.98] font-bold tracking-[-.05em] text-white xl:text-6xl">
            {register ? "Mulai dari satu kelompok" : "Satu buku untuk uang bersama"}<span className="text-gold">.</span>
          </p>
        </div>
        <div className="hero-glass absolute inset-x-9 bottom-9 rounded-2xl px-5 py-4 text-sm leading-relaxed text-stone-100 xl:inset-x-12 xl:bottom-12">
          {register ? "Buat kelompok arisan atau kas, lalu undang anggota dengan tautan." : "Cek iuran, giliran arisan, dan saldo kas dari dasbor kelompokmu."}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col justify-center px-3 py-8 sm:px-12 lg:px-[10%]">
        <div className="mx-auto w-full max-w-[26rem]">
          <div className="mb-9 self-start"><Brand /></div>
          {children}
        </div>
      </div>
    </main>
  );
}
