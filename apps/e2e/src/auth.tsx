import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type User = { email: string; name: string };

export type Session =
  | { status: "signed-out" }
  | { status: "signing-in" }
  | { status: "signed-in"; user: User };

export type SignInResult = { ok: true } | { ok: false; reason: "invalid-credentials" };

const account = { email: "rob@example.com", password: "hunter2", name: "Rob" };

/** Stands in for a network round trip, so a test has to wait the way it would against a real backend. */
export const SIGN_IN_DELAY_MS = 4000;

type Auth = {
  session: Session;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => void;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "signed-out" });

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    setSession({ status: "signing-in" });
    await new Promise((resolve) => setTimeout(resolve, SIGN_IN_DELAY_MS));

    if (email.trim().toLowerCase() !== account.email || password !== account.password) {
      setSession({ status: "signed-out" });
      return { ok: false, reason: "invalid-credentials" };
    }
    setSession({ status: "signed-in", user: { email: account.email, name: account.name } });
    return { ok: true };
  }, []);

  const signOut = useCallback(() => setSession({ status: "signed-out" }), []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (auth === null) throw new Error("useAuth must be used inside an AuthProvider");
  return auth;
}
