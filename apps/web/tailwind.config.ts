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
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // a short, deliberate scale; display sizes are for the serif face only
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.875rem", { lineHeight: "1.375rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.625rem" }],
        xl: ["1.1875rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.01em" }],
        "3xl": ["2rem", { lineHeight: "2.375rem", letterSpacing: "-0.01em" }],
        "4xl": ["2.5rem", { lineHeight: "2.75rem", letterSpacing: "-0.015em" }],
        "5xl": ["3.25rem", { lineHeight: "3.5rem", letterSpacing: "-0.02em" }],
        "6xl": ["4.25rem", { lineHeight: "4.25rem", letterSpacing: "-0.025em" }],
      },
      boxShadow: {
        soft: "0 1px 2px 0 hsl(var(--shadow) / 0.10)",
        panel: "0 1px 0 0 hsl(var(--foreground) / 0.03) inset, 0 12px 32px -16px hsl(var(--shadow) / 0.45)",
        lift: "0 1px 0 0 hsl(var(--foreground) / 0.05) inset, 0 16px 36px -18px hsl(var(--shadow) / 0.55)",
        glow: "0 0 0 1px hsl(var(--glow) / 0.45), 0 0 28px -6px hsl(var(--glow) / 0.55)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        1: "var(--dur-1)",
        2: "var(--dur-2)",
        3: "var(--dur-3)",
        4: "var(--dur-4)",
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
        burst: {
          "0%": { opacity: "0.7", transform: "scale(0.6)" },
          "100%": { opacity: "0", transform: "scale(1.9)" },
        },
        "chip-in": {
          from: { opacity: "0", transform: "translateY(-4px) scale(0.96)", filter: "blur(2px)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)", filter: "blur(0)" },
        },
        caret: { "50%": { opacity: "0" } },
        "page-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "grow-x": { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
        draw: { from: { strokeDashoffset: "1" }, to: { strokeDashoffset: "0" } },
        sweep: {
          "0%, 18%, 100%": { opacity: "0.45", transform: "translateY(0)" },
          "6%": { opacity: "1", transform: "translateY(-2px)" },
        },
      },
      animation: {
        "fade-in": "fade-in var(--dur-2) var(--ease-out)",
        indeterminate: "indeterminate 1.4s var(--ease-in-out) infinite",
        "tick-in": "tick-in var(--dur-2) var(--ease-spring)",
        "rise-in": "rise-in var(--dur-3) var(--ease-out) both",
        burst: "burst 600ms var(--ease-out) forwards",
        "chip-in": "chip-in var(--dur-2) var(--ease-out)",
        caret: "caret 1s steps(1) infinite",
        "page-in": "page-in var(--dur-3) var(--ease-out)",
      },
    },
  },
  plugins: [animate],
};

export default config;
