import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LocationDto } from "@bakery-os/shared";

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string): Promise<LocationDto[]> {
    const locations = await this.prisma.location.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });

    return locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      type: loc.type as LocationDto["type"],
      regionId: loc.regionId,
      city: loc.city,
      address: loc.address,
      lat: loc.lat,
      lng: loc.lng,
    }));
  }
}
