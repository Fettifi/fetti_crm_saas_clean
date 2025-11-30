import { getFettiSequences } from "@/lib/fettiSequences";

export function FeddyAutomationsPanel() {
  const fetti = getFettiSequences();

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold">Fetti Automations</h2>
        <p className="text-xs text-gray-500">
          States: {fetti.config.states.join(", ")} • Pipelines:{" "}
          {fetti.config.pipelines.join(", ")}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="border rounded-xl p-3 shadow-sm">
          <h3 className="font-semibold mb-1 text-sm">SMS Sequence</h3>
          <p className="text-[11px] text-gray-500 mb-2">
            {fetti.sms.meta.description}
          </p>
          <pre className="text-[11px] bg-black/5 p-2 rounded max-h-64 overflow-auto whitespace-pre-wrap">
{fetti.sms.text}
          </pre>
        </div>

        <div className="border rounded-xl p-3 shadow-sm">
          <h3 className="font-semibold mb-1 text-sm">Email Sequence</h3>
          <p className="text-[11px] text-gray-500 mb-2">
            {fetti.email.meta.description}
          </p>
          <pre className="text-[11px] bg-black/5 p-2 rounded max-h-64 overflow-auto whitespace-pre-wrap">
{fetti.email.text}
          </pre>
        </div>

        <div className="border rounded-xl p-3 shadow-sm">
          <h3 className="font-semibold mb-1 text-sm">Voicemail Scripts</h3>
          <p className="text-[11px] text-gray-500 mb-2">
            {fetti.voicemail.meta.description}
          </p>
          <pre className="text-[11px] bg-black/5 p-2 rounded max-h-64 overflow-auto whitespace-pre-wrap">
{fetti.voicemail.text}
          </pre>
        </div>
      </div>
    </div>
  );
}
