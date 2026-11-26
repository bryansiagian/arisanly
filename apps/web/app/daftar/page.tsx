import AccountShell from "../account-shell";
import AuthForm from "../auth-form";

export default function RegisterPage() {
  return (
    <AccountShell register>
      <AuthForm register />
    </AccountShell>
  );
}
