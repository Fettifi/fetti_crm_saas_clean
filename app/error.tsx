"use client";

type ErrorProps = {
  error: Error;
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  console.error(error);

  return (
    <html>
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
          padding: "2rem",
          background: "#020617",
          color: "#e5e7eb",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          FETTI CRM – Something went wrong
        </h1>
        <p style={{ opacity: 0.8 }}>If this keeps happening, call JR.</p>

        <pre
          style={{
            marginTop: "1rem",
            padding: "1rem",
            background: "#0f172a",
            borderRadius: "0.5rem",
            whiteSpace: "pre-wrap",
            fontSize: "0.85rem",
          }}
        >
          {error?.message}
        </pre>

        <button
          onClick={() => reset()}
          style={{
            marginTop: "1rem",
            padding: "8px 16px",
            borderRadius: "999px",
            border: "none",
            background: "#16a34a",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
