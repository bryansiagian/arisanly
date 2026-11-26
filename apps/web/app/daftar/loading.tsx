import AccountShell from "../account-shell";
import { SkeletonRows } from "../skeleton";

export default function Loading() {
  return (
    <AccountShell register>
      <SkeletonRows label="Memuat halaman daftar…" rows={5} />
    </AccountShell>
  );
}
