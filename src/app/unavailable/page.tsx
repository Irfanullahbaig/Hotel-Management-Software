export const metadata = { title: "Online booking" };

export default function UnavailablePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">Online booking is not open yet</h1>
      <p className="mt-2 text-sm text-ink-2">Please contact the hotel directly to make a reservation.</p>
    </main>
  );
}
