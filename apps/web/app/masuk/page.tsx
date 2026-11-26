import AuthForm from "../auth-form";
import AccountShell from "../account-shell";
import SessionRecovery from "./session-recovery";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ sesi?: string; terdaftar?: string }>;
}) {
  const params = await searchParams;
  return (
    <AccountShell>
      {params.sesi === "1" ? <SessionRecovery /> : <AuthForm registered={params.terdaftar === "1"} />}
    </AccountShell>
  );
}
