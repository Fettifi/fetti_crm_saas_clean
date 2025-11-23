import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        fetti: {
          green: "#0BBF6A",
          dark: "#052e16",
          gold: "#FBBF24"
        }
      }
    }
  },
  plugins: []
};

export default config;
