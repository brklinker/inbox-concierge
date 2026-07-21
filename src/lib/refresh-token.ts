export interface RefreshedGoogleToken {
  access_token: string;
  expires_at: number;
  refresh_token?: string;
}

/** Exchange a Google refresh token for a fresh access token. Throws on failure. */
export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<RefreshedGoogleToken> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const tokens = await response.json();
  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status})`);
  }
  return {
    access_token: tokens.access_token,
    expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
    // Google only returns a new refresh_token sometimes.
    refresh_token: tokens.refresh_token ?? undefined,
  };
}
