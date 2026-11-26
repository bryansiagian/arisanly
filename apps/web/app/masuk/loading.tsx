import { SkeletonRows } from "../skeleton";
import AccountShell from "../account-shell";

export default function Loading() {
  return (
    <AccountShell>
      <SkeletonRows label="Memuat halaman masuk…" rows={4} />
    </AccountShell>
  );
}
