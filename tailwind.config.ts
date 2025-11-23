import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        fettiGreen: "#16a34a",
        fettiGold: "#facc15",
        fettiDark: "#020617",
      },
    },
  },
  plugins: [],
};
export default config;
