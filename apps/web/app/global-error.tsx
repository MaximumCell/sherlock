"use client";

import "./globals.css";

// Replaces the root layout when it fails, so it brings its own <html>, <body> and styles.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <title>Something went wrong · Sherlock</title>
        <main
          role="alert"
          className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
        >
          <h1 className="text-2xl font-semibold">Sherlock could not start</h1>
          <p className="text-sm text-muted-foreground">
            The application shell failed to render. Reloading usually fixes it.
          </p>
          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground">ref {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
