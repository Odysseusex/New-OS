import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { audited } from "../audit/audit";
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

  async update(organizationId: string, supplierId: string, dto: UpdateSupplierDto, actorId: string | null = null): Promise<SupplierDto> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) {
      throw new NotFoundException("Поставщик не найден");
    }
    const updated = await audited(
      this.prisma,
      { organizationId, actorId, action: "supplier.update", entityType: "Supplier", entityId: supplierId, before: supplier },
      async (tx) => {
        const saved = await tx.supplier.update({ where: { id: supplierId }, data: dto });
        return { result: saved, after: saved };
      },
    );
    return this.toDto(updated);
  }

  async archive(organizationId: string, supplierId: string, actorId: string | null = null): Promise<SupplierDto> {
    return this.setActive(organizationId, supplierId, false, actorId);
  }

  async restore(organizationId: string, supplierId: string, actorId: string | null = null): Promise<SupplierDto> {
    return this.setActive(organizationId, supplierId, true, actorId);
  }

  async remove(organizationId: string, supplierId: string, actorId: string | null = null): Promise<{ deleted: true }> {
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

    await audited(
      this.prisma,
      { organizationId, actorId, action: "supplier.delete", entityType: "Supplier", entityId: supplierId, before: supplier },
      async (tx) => {
        await tx.supplier.delete({ where: { id: supplierId } });
        return { result: true };
      },
    );
    return { deleted: true };
  }

  private async setActive(organizationId: string, supplierId: string, isActive: boolean, actorId: string | null = null): Promise<SupplierDto> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) {
      throw new NotFoundException("Поставщик не найден");
    }
    const updated = await audited(
      this.prisma,
      { organizationId, actorId, action: isActive ? "supplier.restore" : "supplier.archive", entityType: "Supplier", entityId: supplierId, before: { isActive: supplier.isActive } },
      async (tx) => {
        const saved = await tx.supplier.update({ where: { id: supplierId }, data: { isActive } });
        return { result: saved, after: { isActive: saved.isActive } };
      },
    );
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
