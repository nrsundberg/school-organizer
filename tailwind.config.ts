import type { Config } from "tailwindcss";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./node_modules/@heroui/react/dist/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      gridTemplateColumns: {
        "15": "repeat(15, minmax(0, 1fr))"
      },
      gridTemplateRows: {
        "20": "repeat(20, minmax(0, 1fr))",
        "30": "repeat(30, minmax(0, 1fr))"
      }
    }
  },
  darkMode: "class"
} satisfies Config;
