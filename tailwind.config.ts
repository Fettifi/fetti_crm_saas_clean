import type { Config } from "tailwindcss";

// THE BRAND PALETTE IS SAMPLED FROM RAMON'S OWN EMBLEM, NOT INVENTED.
//
// What was here until 2026-10-17 claimed to be the Fetti palette and was not:
//   fetti.green = #00ff99  (neon mint — nowhere on the emblem, nowhere in the print collateral)
//   fetti.gold  = #ffcc33
// Meanwhile the marketing site used Tailwind's stock `emerald-600` (#059669) in 90 places and the
// real brand green in ZERO, with hero gradients running emerald -> teal-500, a colour the brand does
// not contain. That is the single biggest reason the site reads as generic: it was not wearing the
// brand at all.
//
// These values come from [[fetti-brand-kit-collateral]] — sampled off the emblem itself and already
// in use on every Fetti PDF, the letterhead and the business card. Matching them makes the website
// agree with the paper. Do not "improve" them here; the emblem is the source of truth.
const brand = {
  green: "#309C30",   // bands, rules, primary brand green
  deep: "#23842B",    // deepened green — use when green must carry TEXT contrast
  gold: "#FCC054",    // accent / caution only — rare and meaningful, never a background wash
  wash: "#EFF7EF",    // the pale ground tint

  // FOREST — the dark ground the brand never had, and the absence of it is why the site read as a
  // document. #309C30 is only 3.55:1 on white, so it can never carry text and ends up relegated to
  // one button; the page then has no choice but to be black type on white, which is what a legal
  // filing looks like. A dark green GROUND lets the brand be the page instead of an accent on it.
  //
  // Measured, not guessed — contrast against this ground:
  //   white     12.36:1  (AAA)      wash #EFF7EF  11.31:1      gold #FCC054  7.54:1
  // so body copy, large display and the gold accent are all comfortably AA and mostly AAA.
  // Derived from the emblem green by darkening, not sampled from somewhere new.
  forest: "#0F3D16",
};

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Consumed only by the marketing pages; the CRM keeps Inter. See app/layout.tsx.
        display: ["var(--font-archivo)", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        serif: ["var(--font-serif)", "Iowan Old Style", "Charter", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        fetti: {
          green: brand.green,
          deep: brand.deep,
          gold: brand.gold,
          forest: brand.forest,
          wash: brand.wash,

          // THE INK RAMP. A faint green cast, so the near-monochrome belongs to THIS brand rather
          // than reading as Tailwind slate. Replaces every text-slate-* on the public pages.
          ink: "#0F1511",    // headlines and body
          body: "#3D4A42",   // secondary text and ALL legal copy — 9:1 on white
          muted: "#6B7A70",  // captions, de-emphasised column — 4.6:1, clears AA
          line: "#DCE3DD",   // the hairline that draws the grid
          rule: "#B9C4BB",   // ledger spine, table head rule
          paper: "#FFFFFF",
        },
      },
    },
  },
  plugins: [],
};
export default config;
