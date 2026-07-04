import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VehicleDto } from "@bakery-os/shared";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string): Promise<VehicleDto[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });

    return vehicles.map(this.toDto);
  }

  async create(organizationId: string, dto: CreateVehicleDto): Promise<VehicleDto> {
    const vehicle = await this.prisma.vehicle.create({
      data: { ...dto, organizationId },
    });

    return this.toDto(vehicle);
  }

  private toDto(vehicle: { id: string; name: string; plateNumber: string; status: string }): VehicleDto {
    return {
      id: vehicle.id,
      name: vehicle.name,
      plateNumber: vehicle.plateNumber,
      status: vehicle.status as VehicleDto["status"],
    };
  }
}
