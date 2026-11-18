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
}

export interface JwtPayload {
  sub: string;
  organizationId: string;
  // Set only on the long-lived key of «Помощник»: must equal User.assistantKeyId.
  ak?: string;
}
