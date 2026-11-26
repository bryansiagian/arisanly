import Brand from "../brand";
import { SkeletonRows } from "../skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-8 lg:px-12">
      <header className="dashboard-nav flex items-center justify-between border-b border-line py-3">
        <Brand />
        <div aria-hidden="true" className="skeleton h-11 w-20 rounded-lg" />
      </header>
      <main className="pt-5 sm:pt-8">
        <div aria-hidden="true" className="space-y-3 border-b border-line py-7 sm:py-11">
          <div className="skeleton h-4 w-16 rounded" />
          <div className="skeleton h-12 w-3/4 max-w-lg rounded-lg sm:h-20" />
          <div className="skeleton h-4 w-44 rounded" />
        </div>
        <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-9">
          <div className="dashboard-glass lg:col-start-2 lg:row-start-1">
            <div aria-hidden="true" className="skeleton h-11 rounded-lg" />
          </div>
          <div className="lg:col-start-1 lg:row-start-1">
            <SkeletonRows label="Memuat dasbor…" />
          </div>
        </div>
      </main>
    </div>
  );
}
