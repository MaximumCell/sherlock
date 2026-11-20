"use client";

import { Mail } from "lucide-react";
import { env } from "@/lib/env";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SignInOutcome } from "@/lib/data/types";
import { validateTarget } from "@/lib/validation";
import { BrandMark } from "./nav";

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export function SignInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { ds } = useData();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"google" | "github" | "email" | null>(null);
  const [sent, setSent] = useState(false);

  const run = async (kind: "google" | "github" | "email", action: () => Promise<SignInOutcome>) => {
    setPending(kind);
    setError(null);
    try {
      const outcome = await action();
      if (outcome === "email_sent") setSent(true);
      if (outcome === "signed_in") {
        toast.success("Signed in", { description: "Name search is now available." });
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setPending(null);
    }
  };

  const redirectTo = () => window.location.href;

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const result = validateTarget("email", email);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    void run("email", () => ds.signInWithEmail(result.value, redirectTo()));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <BrandMark className="mb-2 h-8 w-8 text-foreground" />
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            A guest session is enough for most scans. Signing in upgrades this session, keeps your
            cases, and enables name search.
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <p role="status" className="animate-fade-in rounded-md border border-success/30 bg-success/10 p-3 text-sm">
            Check your inbox: we sent a sign-in link to <span className="font-mono">{email}</span>.
          </p>
        ) : (
          <div className="space-y-4">
            {env.oauthProviders.includes("google") ? (
              <Button
                variant="outline"
                className="w-full"
                disabled={pending !== null}
                onClick={() => void run("google", () => ds.signInWithGoogle(redirectTo()))}
              >
                <GoogleMark />
                {pending === "google" ? "Redirecting…" : "Continue with Google"}
              </Button>
            ) : null}
            {env.oauthProviders.includes("github") ? (
              <Button
                variant="outline"
                className="w-full"
                disabled={pending !== null}
                onClick={() => void run("github", () => ds.signInWithGitHub(redirectTo()))}
              >
                <GitHubMark />
                {pending === "github" ? "Redirecting…" : "Continue with GitHub"}
              </Button>
            ) : null}
            {env.oauthProviders.length > 0 ? (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <form onSubmit={submitEmail} className="space-y-2" noValidate>
              <Label htmlFor="sign-in-email">Email magic link</Label>
              <div className="flex gap-2">
                <Input
                  id="sign-in-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "sign-in-error" : undefined}
                />
                <Button type="submit" disabled={pending !== null}>
                  <Mail aria-hidden />
                  {pending === "email" ? "Sending…" : "Send link"}
                </Button>
              </div>
            </form>
            {error ? (
              <p id="sign-in-error" role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
