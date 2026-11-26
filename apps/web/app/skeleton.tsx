export function SkeletonRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid gap-2">
        {Array.from({ length: rows }, (_, index) => <div key={index} className="skeleton h-11 rounded-lg" />)}
      </div>
    </div>
  );
}

export function PageSkeleton({ kind = "form", label = "Memuat halaman…" }: {
  kind?: "form" | "dashboard" | "landing";
  label?: string;
}) {
  return (
    <main role="status" className={kind === "form" ? "mx-auto max-w-lg px-5 py-10" : "mx-auto max-w-6xl px-5 py-6 sm:px-8"}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <div className="mb-6 flex items-center justify-between pb-4">
          <div className="skeleton h-10 w-28 rounded-xl" />
          {kind !== "form" && <div className="skeleton h-10 w-20 rounded-lg" />}
        </div>
        {kind === "landing" ? (
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="skeleton h-14 w-full rounded-xl sm:h-20" />
              <div className="skeleton h-14 w-4/5 rounded-xl sm:h-20" />
              <div className="skeleton h-11 w-32 rounded-lg" />
            </div>
            <div className="skeleton aspect-square rounded-3xl" />
          </div>
        ) : (
          <>
            <div className="panel grid gap-4">
              <div className="skeleton h-9 w-1/2 rounded-lg" />
              <div className="skeleton h-5 w-2/3 rounded-md" />
              {kind === "form" && <><div className="skeleton h-11 rounded-lg" /><div className="skeleton h-11 rounded-lg" /></>}
            </div>
            {kind === "dashboard" && <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="skeleton h-28 rounded-2xl" />
              <div className="skeleton h-28 rounded-2xl" />
              <div className="skeleton h-28 rounded-2xl" />
            </div>}
          </>
        )}
      </div>
    </main>
  );
}
