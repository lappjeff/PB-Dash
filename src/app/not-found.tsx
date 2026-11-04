import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="text-center">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">This record does not exist or you do not have access to it.</p>
        <Link className="mt-3 inline-block text-sm underline" href="/">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
