/**
 * Signing in from an anonymous session first tries to UPGRADE that session (link an identity,
 * or attach an email), so the cases it created stay with the account. Only when that fails
 * (for example the email or identity already belongs to another account) does it fall back to a
 * plain sign-in, which starts a different user.
 */
export interface AuthResult {
  error: { message: string } | null;
}

export type UpgradePath = "upgraded" | "signed_in";

export async function upgradeOrSignIn(
  anonymous: boolean,
  upgrade: () => Promise<AuthResult>,
  signIn: () => Promise<AuthResult>,
  failure: string,
): Promise<UpgradePath> {
  if (anonymous) {
    const upgraded = await upgrade();
    if (!upgraded.error) return "upgraded";
  }
  const { error } = await signIn();
  if (error) throw new Error(`${failure}: ${error.message}`);
  return "signed_in";
}
