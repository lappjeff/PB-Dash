import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) redirect("/");
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <SignIn />
    </main>
  );
}
