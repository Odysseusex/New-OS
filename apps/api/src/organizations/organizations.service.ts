import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async getSummary(organizationId: string) {
    const [organization, locationsCount, regionsCount, usersCount] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      this.prisma.location.count({ where: { organizationId } }),
      this.prisma.region.count({ where: { organizationId } }),
      this.prisma.user.count({ where: { organizationId } }),
    ]);

    return { organization, locationsCount, regionsCount, usersCount };
  }
}
