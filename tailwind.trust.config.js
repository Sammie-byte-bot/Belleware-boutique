/** Tailwind config for trust.js + policies.html only (outputs trust.css) */
module.exports = {
  content: ["./policies.html", "./trust.js"],
  corePlugins: { preflight: false }, // don't reset the existing style.css pages
  theme: {
    extend: {
      colors: { brand: "#088178", "brand-dark": "#0f766e", ink: "#1a1a1a" },
    },
  },
  plugins: [],
};
