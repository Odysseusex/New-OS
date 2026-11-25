import { Role } from "@bakery-os/shared";

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  title: string | null;
  organizationId: string;
  regionId: string | null;
  locationId: string | null;
  // The point's shared till login (User.sharedTill): may not sell or run a shift.
  sharedTill?: boolean;
}

export interface JwtPayload {
  sub: string;
  organizationId: string;
  // Set only on the long-lived key of «Помощник»: must equal User.assistantKeyId.
  ak?: string;
  // A stamp of the password the token was issued under: changing the password ends every
  // session opened before it (a stolen or forgotten login stops working at once, not in 8 hours).
  pv?: string;
}
