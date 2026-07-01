import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        blush: "#ffd7e4",
        rose: "#ff8fab",
        cocoa: "#5b3a4a",
      },
      fontFamily: {
        display: ["ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
