import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "attention" | "danger";

const tones: Record<string, Tone> = {
  PENDING: "attention",
  UPCOMING: "attention",
  TODAY: "attention",
  OVERDUE: "danger",
  LATE: "danger",
  REJECTED: "danger",
  CONFIRMED: "success",
  PAID: "success",
};

export default function StatusLabel({ status, children }: { status?: string | null; children: ReactNode }) {
  return <span className="status-label" data-tone={tones[status ?? ""] ?? "neutral"}>{children}</span>;
}
