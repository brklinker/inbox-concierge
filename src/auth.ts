import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { refreshGoogleAccessToken } from "@/lib/refresh-token";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshTokenError";
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    access_token: string;
    expires_at: number;
    refresh_token?: string;
    error?: "RefreshTokenError";
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          access_token: account.access_token!,
          expires_at: account.expires_at!,
          refresh_token: account.refresh_token,
        };
      }
      // Refresh a minute early to avoid using a token that expires mid-request.
      if (Date.now() < token.expires_at * 1000 - 60_000) {
        return token;
      }
      if (!token.refresh_token) {
        return { ...token, error: "RefreshTokenError" as const };
      }
      try {
        const refreshed = await refreshGoogleAccessToken(token.refresh_token);
        return {
          ...token,
          access_token: refreshed.access_token,
          expires_at: refreshed.expires_at,
          refresh_token: refreshed.refresh_token ?? token.refresh_token,
          error: undefined,
        };
      } catch {
        return { ...token, error: "RefreshTokenError" as const };
      }
    },
    async session({ session, token }) {
      session.accessToken = token.access_token;
      session.error = token.error;
      return session;
    },
  },
});
