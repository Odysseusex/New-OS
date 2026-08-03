import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SupplierDto } from "@bakery-os/shared";
import { CreateSupplierDto } from "./dto/create-supplier.dto";
import { UpdateSupplierDto } from "./dto/update-supplier.dto";

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<SupplierDto[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: { name: "asc" },
    });

    return suppliers.map(this.toDto);
  }

  async create(organizationId: string, dto: CreateSupplierDto): Promise<SupplierDto> {
    const supplier = await this.prisma.supplier.create({
      data: { ...dto, organizationId },
    });

    return this.toDto(supplier);
  }

  async update(organizationId: string, supplierId: string, dto: UpdateSupplierDto): Promise<SupplierDto> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) {
      throw new NotFoundException("Поставщик не найден");
    }
    const updated = await this.prisma.supplier.update({ where: { id: supplierId }, data: dto });
    return this.toDto(updated);
  }

  async archive(organizationId: string, supplierId: string): Promise<SupplierDto> {
    return this.setActive(organizationId, supplierId, false);
  }

  async restore(organizationId: string, supplierId: string): Promise<SupplierDto> {
    return this.setActive(organizationId, supplierId, true);
  }

  async remove(organizationId: string, supplierId: string): Promise<{ deleted: true }> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) {
      throw new NotFoundException("Поставщик не найден");
    }
    const ordersCount = await this.prisma.purchaseOrder.count({ where: { supplierId } });
    if (ordersCount > 0) {
      throw new BadRequestException(
        "Нельзя удалить поставщика — у него есть заказы. Заархивируйте его вместо удаления.",
      );
    }

    await this.prisma.supplier.delete({ where: { id: supplierId } });
    return { deleted: true };
  }

  private async setActive(organizationId: string, supplierId: string, isActive: boolean): Promise<SupplierDto> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) {
      throw new NotFoundException("Поставщик не найден");
    }
    const updated = await this.prisma.supplier.update({ where: { id: supplierId }, data: { isActive } });
    return this.toDto(updated);
  }

  private toDto(supplier: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
    isActive: boolean;
  }): SupplierDto {
    return {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
      notes: supplier.notes,
      isActive: supplier.isActive,
    };
  }
}
