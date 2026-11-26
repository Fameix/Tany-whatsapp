import { PhoneLoginForm } from "./phone-login-form";

export default function LoginPage() {
  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-12">
    <section className="w-full rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">Tany Messaging</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Sign in with your phone</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">We’ll send a one-time code to the phone number linked to your workspace.</p>
      <PhoneLoginForm />
    </section>
  </main>;
}
