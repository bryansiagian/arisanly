import Link from "next/link";

export default function Brand() {
  return (
    <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 text-xl font-bold tracking-tight">
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-brand text-sm font-bold text-white">A</span>
      Arisanly
    </Link>
  );
}
