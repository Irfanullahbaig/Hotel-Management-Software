"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const denied = error.message.includes("permission");
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-lg font-semibold">{denied ? "You don't have access to this page" : "This page could not be loaded"}</h1>
      <p className="mt-2 text-sm text-ink-3">{denied ? "Ask an administrator to grant your role the permission you need." : "Nothing was changed. Try again, and contact support if it keeps happening."}</p>
      {!denied && <button onClick={reset} className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">Try again</button>}
    </div>
  );
}
