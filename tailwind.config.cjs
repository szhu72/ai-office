/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ember: "#EE6C29",
        charcoal: "#282B2B",
        ocean: "#7AA6B3",
        amber: "#F39120",
        paper: "#E2DAC2",
      },
    },
  },
  plugins: [],
};
