import AuthForm from "../auth-form";
import SessionRecovery from "./session-recovery";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ sesi?: string; terdaftar?: string }>;
}) {
  const params = await searchParams;
  if (params.sesi === "1") return <SessionRecovery />;
  return <AuthForm registered={params.terdaftar === "1"} />;
}
