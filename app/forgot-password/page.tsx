import AuthShell from "@/components/AuthShell";
import ForgotPasswordForm from "./ForgotPasswordForm";

export const metadata = {
  title: "Forgot password — Alliance Social Analytics",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Forgot your password?">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
