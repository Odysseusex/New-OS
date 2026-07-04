import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProductDto } from "@bakery-os/shared";
import { CreateProductDto } from "./dto/create-product.dto";

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string): Promise<ProductDto[]> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: "asc" },
    });

    return products.map(this.toDto);
  }

  async create(organizationId: string, dto: CreateProductDto): Promise<ProductDto> {
    const existing = await this.prisma.product.findUnique({
      where: { organizationId_sku: { organizationId, sku: dto.sku } },
    });
    if (existing) {
      throw new ConflictException("Товар с таким артикулом уже существует");
    }

    const product = await this.prisma.product.create({
      data: { ...dto, organizationId },
    });

    return this.toDto(product);
  }

  private toDto(product: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    category: string;
    price: { toNumber: () => number };
    isActive: boolean;
  }): ProductDto {
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit as ProductDto["unit"],
      category: product.category,
      price: product.price.toNumber(),
      isActive: product.isActive,
    };
  }
}
