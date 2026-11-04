import Link from "next/link";

export function Forbidden({ message = "This page is only available to administrators." }: { message?: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border bg-card p-6 text-center">
      <h1 className="text-base font-semibold">Not available</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-2">
        Go to your dashboard
      </Link>
    </div>
  );
}

export function NotLinked() {
  return (
    <Forbidden message="Your account is not linked to a Precise Builder salesperson yet. An administrator can link it under Settings → Users." />
  );
}
