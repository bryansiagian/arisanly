import AuthForm from "../auth-form";
import LoginShell from "./login-shell";
import SessionRecovery from "./session-recovery";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ sesi?: string; terdaftar?: string }>;
}) {
  const params = await searchParams;
  return (
    <LoginShell>
      {params.sesi === "1" ? <SessionRecovery /> : <AuthForm registered={params.terdaftar === "1"} />}
    </LoginShell>
  );
}
