import { SkeletonRows } from "../skeleton";
import LoginShell from "./login-shell";

export default function Loading() {
  return (
    <LoginShell>
      <SkeletonRows label="Memuat halaman masuk…" rows={4} />
    </LoginShell>
  );
}
