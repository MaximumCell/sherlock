import type { ReactNode } from "react";

// Re-mounted on every navigation: a short opacity fade between routes. Opacity only, so
// fixed and sticky descendants (tour, sticky rail) keep their positioning.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
