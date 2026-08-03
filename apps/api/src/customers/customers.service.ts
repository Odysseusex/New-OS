import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CustomerDetailDto, CustomerDto, CustomerOrderDto, PaymentStatus } from "@bakery-os/shared";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAllForOrganization(organizationId: string, includeArchived = false): Promise<CustomerDto[]> {
    const [customers, balances] = await Promise.all([
      this.prisma.customer.findMany({
        where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
        orderBy: { name: "asc" },
      }),
      this.prisma.sale.groupBy({
        by: ["customerId"],
        where: { organizationId, customerId: { not: null } },
        _sum: { totalAmount: true, amountPaid: true },
      }),
    ]);

    const balanceByCustomer = new Map(
      balances.map((b) => [
        b.customerId as string,
        (b._sum.totalAmount?.toNumber() ?? 0) - (b._sum.amountPaid?.toNumber() ?? 0),
      ]),
    );

    return customers.map((c) => this.toCustomerDto(c, balanceByCustomer.get(c.id) ?? 0));
  }

  async create(organizationId: string, dto: CreateCustomerDto): Promise<CustomerDto> {
    const customer = await this.prisma.customer.create({
      data: { ...dto, organizationId },
    });

    return this.toCustomerDto(customer, 0);
  }

  async update(organizationId: string, customerId: string, dto: UpdateCustomerDto): Promise<CustomerDto> {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) {
      throw new NotFoundException("Клиент не найден");
    }

    const updated = await this.prisma.customer.update({ where: { id: customerId }, data: dto });
    const balance = await this.getOutstandingBalance(organizationId, customerId);
    return this.toCustomerDto(updated, balance);
  }

  async archive(organizationId: string, customerId: string): Promise<CustomerDto> {
    return this.setActive(organizationId, customerId, false);
  }

  async restore(organizationId: string, customerId: string): Promise<CustomerDto> {
    return this.setActive(organizationId, customerId, true);
  }

  async remove(organizationId: string, customerId: string): Promise<{ deleted: true }> {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) {
      throw new NotFoundException("Клиент не найден");
    }
    const salesCount = await this.prisma.sale.count({ where: { customerId } });
    if (salesCount > 0) {
      throw new BadRequestException(
        "Нельзя удалить клиента — у него есть продажи. Заархивируйте его вместо удаления.",
      );
    }

    await this.prisma.customer.delete({ where: { id: customerId } });
    return { deleted: true };
  }

  async findOne(organizationId: string, customerId: string): Promise<CustomerDetailDto> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundException("Клиент не найден");
    }

    const sales = await this.prisma.sale.findMany({
      where: { organizationId, customerId },
      include: { location: true },
      orderBy: { soldAt: "desc" },
    });

    const orders: CustomerOrderDto[] = sales.map((sale) => {
      const totalAmount = sale.totalAmount.toNumber();
      const amountPaid = sale.amountPaid.toNumber();
      const balanceDue = totalAmount - amountPaid;

      return {
        saleId: sale.id,
        locationName: sale.location.name,
        soldAt: sale.soldAt.toISOString(),
        totalAmount,
        amountPaid,
        balanceDue,
        paymentStatus:
          balanceDue <= 0
            ? PaymentStatus.PAID
            : amountPaid > 0
              ? PaymentStatus.PARTIALLY_PAID
              : PaymentStatus.UNPAID,
      };
    });

    const outstandingBalance = orders.reduce((sum, o) => sum + o.balanceDue, 0);

    return { ...this.toCustomerDto(customer, outstandingBalance), orders };
  }

  private async getOutstandingBalance(organizationId: string, customerId: string): Promise<number> {
    const sales = await this.prisma.sale.findMany({ where: { organizationId, customerId } });
    return sales.reduce((sum, s) => sum + (s.totalAmount.toNumber() - s.amountPaid.toNumber()), 0);
  }

  private async setActive(organizationId: string, customerId: string, isActive: boolean): Promise<CustomerDto> {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) {
      throw new NotFoundException("Клиент не найден");
    }
    const updated = await this.prisma.customer.update({ where: { id: customerId }, data: { isActive } });
    const balance = await this.getOutstandingBalance(organizationId, customerId);
    return this.toCustomerDto(updated, balance);
  }

  private toCustomerDto(
    customer: {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      address: string | null;
      lat: number | null;
      lng: number | null;
      notes: string | null;
      creditLimit: { toNumber: () => number } | null;
      isActive: boolean;
    },
    outstandingBalance: number,
  ): CustomerDto {
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      lat: customer.lat,
      lng: customer.lng,
      notes: customer.notes,
      creditLimit: customer.creditLimit ? customer.creditLimit.toNumber() : null,
      outstandingBalance,
      isActive: customer.isActive,
    };
  }
}
