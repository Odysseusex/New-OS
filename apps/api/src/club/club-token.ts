import { JwtService } from "@nestjs/jwt";

// Customer-app sessions are JWTs signed with a key DIFFERENT from staff logins,
// so a customer token can never be presented as a staff one (and vice versa).
// The token only names the session row; the row decides whether it is still valid.

const baseSecret = () => process.env.JWT_SECRET ?? "dev-secret-change-me";
const clubJwt = () => new JwtService({ secret: `${baseSecret()}:club` });

export interface ClubTokenPayload {
  sid: string;
}

export function signClubToken(sessionId: string): string {
  return clubJwt().sign({ sid: sessionId } satisfies ClubTokenPayload, { expiresIn: "365d" });
}

export function verifyClubToken(token: string): ClubTokenPayload | null {
  try {
    const payload = clubJwt().verify<ClubTokenPayload & { iat: number }>(token);
    return typeof payload.sid === "string" ? { sid: payload.sid } : null;
  } catch {
    return null;
  }
}
