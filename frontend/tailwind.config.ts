import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: {
        "2xl": "1180px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        tertiary: "hsl(var(--tertiary))",
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        cyan: {
          DEFAULT: "hsl(var(--cyan))",
          foreground: "hsl(var(--cyan-foreground))",
        },
        // Status (OSINT-specific semantic colors)
        "status-found": "hsl(var(--status-found))",
        "status-found-bg": "hsl(var(--status-found-bg))",
        "status-found-border": "hsl(var(--status-found-border))",
        "status-error": "hsl(var(--status-error))",
        "status-error-bg": "hsl(var(--status-error-bg))",
        "status-error-border": "hsl(var(--status-error-border))",
        "status-warning": "hsl(var(--status-warning))",
        "status-warning-bg": "hsl(var(--status-warning-bg))",
        "status-warning-border": "hsl(var(--status-warning-border))",
        "status-info": "hsl(var(--status-info))",
        "status-info-bg": "hsl(var(--status-info-bg))",
        "status-info-border": "hsl(var(--status-info-border))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-fira-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["var(--font-fira-code)", "ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": "0.6875rem", // 11px
        xs: "0.75rem",      // 12px
        sm: "0.8125rem",    // 13px
        base: "0.875rem",   // 14px
        lg: "1rem",         // 16px
        xl: "1.125rem",     // 18px
        "2xl": "1.375rem",  // 22px
        "3xl": "1.625rem",  // 26px
        "4xl": "1.75rem",   // 28px
      },
      boxShadow: {
        glow: "0 0 24px -4px hsl(var(--accent) / 0.35)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-accent": {
          "0%, 100%": { boxShadow: "0 0 0 0 hsl(var(--accent) / 0.4)" },
          "50%": { boxShadow: "0 0 0 8px hsl(var(--accent) / 0)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-accent": "pulse-accent 2s ease-in-out infinite",
        "fade-in": "fade-in 200ms ease-out",
        "scale-in": "scale-in 150ms ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
