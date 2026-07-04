import { Role } from "@bakery-os/shared";

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  organizationId: string;
  regionId: string | null;
  locationId: string | null;
}

export interface JwtPayload {
  sub: string;
  organizationId: string;
}
