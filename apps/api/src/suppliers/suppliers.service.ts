import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SupplierDto } from "@bakery-os/shared";
import { CreateSupplierDto } from "./dto/create-supplier.dto";

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string): Promise<SupplierDto[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { organizationId, isActive: true },
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

  private toDto(supplier: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
  }): SupplierDto {
    return {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
      notes: supplier.notes,
    };
  }
}
