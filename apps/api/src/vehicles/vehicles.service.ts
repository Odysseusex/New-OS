import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VehicleDto } from "@bakery-os/shared";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<VehicleDto[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
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

  async update(organizationId: string, vehicleId: string, dto: UpdateVehicleDto): Promise<VehicleDto> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, organizationId } });
    if (!vehicle) {
      throw new NotFoundException("Транспорт не найден");
    }
    const updated = await this.prisma.vehicle.update({ where: { id: vehicleId }, data: dto });
    return this.toDto(updated);
  }

  async archive(organizationId: string, vehicleId: string): Promise<VehicleDto> {
    return this.setActive(organizationId, vehicleId, false);
  }

  async restore(organizationId: string, vehicleId: string): Promise<VehicleDto> {
    return this.setActive(organizationId, vehicleId, true);
  }

  async remove(organizationId: string, vehicleId: string): Promise<{ deleted: true }> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, organizationId } });
    if (!vehicle) {
      throw new NotFoundException("Транспорт не найден");
    }
    const routesCount = await this.prisma.deliveryRoute.count({ where: { vehicleId } });
    if (routesCount > 0) {
      throw new BadRequestException(
        "Нельзя удалить транспорт — он уже использовался в маршрутах. Заархивируйте его вместо удаления.",
      );
    }

    await this.prisma.vehicle.delete({ where: { id: vehicleId } });
    return { deleted: true };
  }

  private async setActive(organizationId: string, vehicleId: string, isActive: boolean): Promise<VehicleDto> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, organizationId } });
    if (!vehicle) {
      throw new NotFoundException("Транспорт не найден");
    }
    const updated = await this.prisma.vehicle.update({ where: { id: vehicleId }, data: { isActive } });
    return this.toDto(updated);
  }

  private toDto(vehicle: {
    id: string;
    name: string;
    plateNumber: string;
    status: string;
    isActive: boolean;
  }): VehicleDto {
    return {
      id: vehicle.id,
      name: vehicle.name,
      plateNumber: vehicle.plateNumber,
      status: vehicle.status as VehicleDto["status"],
      isActive: vehicle.isActive,
    };
  }
}
