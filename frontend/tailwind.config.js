/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0A0A0A",
        panel: "#111318",
        line: "#24262D",
        accent: "#3B82F6"
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui"] },
      borderRadius: { card: "8px", button: "8px" }
    }
  },
  plugins: []
};
