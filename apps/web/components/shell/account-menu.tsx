"use client";

import { LogIn, LogOut, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/query/hooks";
import { onSignInRequest } from "@/lib/sign-in-prompt";
import { SignInDialog } from "./sign-in-dialog";

export function AccountMenu() {
  const { ds } = useData();
  const session = useSession();
  const [signInOpen, setSignInOpen] = useState(false);
  const user = session.data;
  const signedIn = Boolean(user && !user.anonymous);
  useEffect(() => onSignInRequest(() => setSignInOpen(true)), []);

  const signOut = async () => {
    try {
      await ds.signOut();
      await session.refetch();
      toast.success("Signed out", { description: "You are back on a guest session." });
    } catch (err) {
      toast.error("Could not sign out", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Account menu">
            <UserRound aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="space-y-0.5 normal-case tracking-normal">
            <p className="text-sm font-medium">
              {session.isError
                ? "No session"
                : signedIn
                  ? (user?.email ?? "Signed in")
                  : "Guest session"}
            </p>
            <p className="text-xs font-normal text-muted-foreground">
              {session.isError
                ? "Could not reach the auth service."
                : signedIn
                  ? "Name search is enabled."
                  : "Anonymous. Your cases stay tied to this browser."}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {signedIn ? (
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut aria-hidden />
              Sign out
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setSignInOpen(true)}>
              <LogIn aria-hidden />
              Sign in
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </>
  );
}
