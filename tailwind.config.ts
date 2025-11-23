import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fetti: {
          green: "#00ff99",
          gold: "#ffcc33",
        },
      },
    },
  },
  plugins: [],
};
export default config;
