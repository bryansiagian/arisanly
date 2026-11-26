import { SkeletonRows } from "../skeleton";
import JoinShell from "./join-shell";

export default function Loading() {
  return <JoinShell><SkeletonRows label="Memuat halaman gabung…" /></JoinShell>;
}
