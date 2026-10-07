/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#FBF7EE",
          deep: "#F3ECDD",
          edge: "#E7DDC8",
        },
        ink: {
          DEFAULT: "#16305C",
          soft: "#2C4A7C",
          faint: "#7C8DB0",
        },
        margin: {
          DEFAULT: "#D6556A",
          soft: "#F0AEB8",
        },
        pencil: "#4A4A55",
        kraft: "#C8A97E",
        marker: {
          DEFAULT: "#E9A23B",
          soft: "#FBE3B8",
        },
        sage: {
          DEFAULT: "#4E7A63",
          soft: "#DDEBE1",
        },
      },
      fontFamily: {
        hand: ["CaveatLocal", "Caveat", "cursive"],
      },
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        note: "0 10px 30px -12px rgba(22, 48, 92, 0.35)",
        paper: "0 1px 0 rgba(255,255,255,0.6) inset, 0 18px 40px -24px rgba(22,48,92,0.45)",
      },
      keyframes: {
        "ink-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "draw-line": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
      },
      animation: {
        "ink-in": "ink-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        "draw-line": "draw-line 0.9s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
