import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const withAlpha = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        border: withAlpha("border"),
        input: withAlpha("input"),
        ring: withAlpha("ring"),
        background: withAlpha("background"),
        foreground: withAlpha("foreground"),
        surface: withAlpha("surface"),
        primary: { DEFAULT: withAlpha("primary"), foreground: withAlpha("primary-foreground") },
        secondary: {
          DEFAULT: withAlpha("secondary"),
          foreground: withAlpha("secondary-foreground"),
        },
        destructive: {
          DEFAULT: withAlpha("destructive"),
          foreground: withAlpha("destructive-foreground"),
        },
        muted: { DEFAULT: withAlpha("muted"), foreground: withAlpha("muted-foreground") },
        accent: { DEFAULT: withAlpha("accent"), foreground: withAlpha("accent-foreground") },
        popover: { DEFAULT: withAlpha("popover"), foreground: withAlpha("popover-foreground") },
        card: { DEFAULT: withAlpha("card"), foreground: withAlpha("card-foreground") },
        success: withAlpha("success"),
        warning: withAlpha("warning"),
        danger: withAlpha("danger"),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.875rem", { lineHeight: "1.375rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.625rem" }],
        xl: ["1.1875rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.01em" }],
        "3xl": ["1.875rem", { lineHeight: "2.375rem", letterSpacing: "-0.015em" }],
        "4xl": ["2.375rem", { lineHeight: "2.875rem", letterSpacing: "-0.02em" }],
        "5xl": ["3rem", { lineHeight: "3.5rem", letterSpacing: "-0.025em" }],
      },
      boxShadow: {
        panel: "0 1px 0 0 hsl(var(--shadow) / 0.04), 0 8px 24px -12px hsl(var(--shadow) / 0.35)",
        soft: "0 1px 2px 0 hsl(var(--shadow) / 0.05), 0 1px 1px 0 hsl(var(--shadow) / 0.03)",
        lift: "0 1px 2px 0 hsl(var(--shadow) / 0.06), 0 12px 32px -16px hsl(var(--shadow) / 0.3)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(350%)" },
        },
        "tick-in": {
          from: { opacity: "0", transform: "scale(0.6)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out",
        indeterminate: "indeterminate 1.4s ease-in-out infinite",
        "tick-in": "tick-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1.2)",
        "rise-in": "rise-in 260ms ease-out",
      },
    },
  },
  plugins: [animate],
};

export default config;
