import { OAuth2Client, type TokenPayload } from "google-auth-library";
import type { VerifiedUser, VerifyUser } from "./types.js";

export function authorizePayload(payload: TokenPayload | undefined, allowedEmails: Set<string>): VerifiedUser {
  const email = payload?.email?.toLowerCase();
  if (!payload?.sub || !email || payload.email_verified !== true) throw new Error("Unverified Google identity.");
  if (!allowedEmails.has(email)) throw new Error("Google identity is not authorized.");
  return { subject: payload.sub, email };
}

export function createGoogleTokenVerifier(clientId: string, allowedEmails: Set<string>, client = new OAuth2Client()): VerifyUser {
  return async (idToken) => {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    return authorizePayload(ticket.getPayload(), allowedEmails);
  };
}
