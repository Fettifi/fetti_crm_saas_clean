export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-gray-100">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/fetti-logo.png"
          alt="Fetti"
          className="h-32 w-32 rounded-2xl bg-white p-4 shadow-xl"
        />
        <div className="h-10 w-10 rounded-full border-4 border-gray-600 border-t-green-500 animate-spin" />
        <h1 className="text-2xl font-bold mt-2 tracking-wide">Fetti CRM</h1>
        <p className="text-sm text-gray-400">We Do Money…</p>
      </div>
    </div>
  );
}
