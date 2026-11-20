"use client";

import { LogIn, LogOut, ScrollText, ShieldHalf, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAdminMe } from "@/lib/admin/hooks";
import { useAdvanced } from "@/lib/preferences";
import { useSession } from "@/lib/query/hooks";
import { onSignInRequest } from "@/lib/sign-in-prompt";
import { SignInDialog } from "./sign-in-dialog";

export function AccountMenu() {
  const { ds } = useData();
  const session = useSession();
  const [signInOpen, setSignInOpen] = useState(false);
  const [advanced, setAdvanced] = useAdvanced();
  const user = session.data;
  const signedIn = Boolean(user && !user.anonymous);
  // Only asked for signed-in sessions, without cold-start retries: guests never wake the gateway for it.
  const operator = useAdminMe({ quiet: true }).data;
  const pathname = usePathname();
  const adminHref = pathname?.startsWith("/demo") ? "/demo/admin" : "/admin";
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
          <DropdownMenuItem asChild>
            <Link href="/audit">
              <ScrollText aria-hidden />
              Activity log
            </Link>
          </DropdownMenuItem>
          {operator ? (
            <DropdownMenuItem asChild>
              <Link href={adminHref}>
                <ShieldHalf aria-hidden />
                Operator panel
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuCheckboxItem
            checked={advanced}
            onCheckedChange={(checked) => setAdvanced(checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            Advanced details
          </DropdownMenuCheckboxItem>
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
