import { redirect } from "next/navigation";
import { BedDouble } from "lucide-react";
import { getAuth } from "@/server/auth/context";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getAuth()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-brand p-10 text-white lg:flex">
        <div className="flex items-center gap-2 font-semibold"><BedDouble className="size-5" /> Hotel Management System</div>
        <div>
          <p className="max-w-md text-2xl leading-snug font-medium">Reservations, front desk, housekeeping and accounts in one place.</p>
          <p className="mt-3 max-w-md text-sm text-white/70">Every booking, check-in and payment updates rooms, folios and the ledger together.</p>
        </div>
        <p className="text-xs text-white/50">Authorised staff only. Activity is logged.</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-ink-3">Use the account your administrator created for you.</p>
          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}
