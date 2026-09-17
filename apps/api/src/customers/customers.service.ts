import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  BusinessContextCustomerRowDto,
  BusinessContextCustomersDto,
  CustomerDetailDto,
  CustomerDto,
  CustomerOrderDto,
  PaymentStatus,
} from "@bakery-os/shared";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  // Revenue per named customer over a period, plus what retail took.
  //
  // A groupBy on sales, then ONE lookup for the names — not a query per
  // customer. Sales with no customerId are walk-in retail: they are a real
  // and usually dominant part of the takings, so they are reported as their
  // own figure rather than dropped for having nobody to attribute them to.
  //
  // Contact details (phone, email, address, coordinates, notes) are
  // deliberately never selected here: none of them is needed to answer a
  // question about revenue, and this data is leaving the building.
  async revenueByCustomer(
    organizationId: string,
    from: Date,
    to: Date,
    locationId?: string,
  ): Promise<BusinessContextCustomersDto> {
    const scope = {
      organizationId,
      soldAt: { gte: from, lte: to },
      ...(locationId ? { locationId } : {}),
    };

    const [grouped, activeCount] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ["customerId"],
        where: scope,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.customer.count({ where: { organizationId, isActive: true } }),
    ]);

    const customerIds = grouped.map((g) => g.customerId).filter((id): id is string => id !== null);
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true, creditLimit: true },
        })
      : [];
    const byId = new Map(customers.map((c) => [c.id, c]));

    // Outstanding balance is what they owe IN TOTAL, not within the period —
    // a debt from last month is still a debt today, and scoping it to the
    // window would understate it. Same definition getOutstandingBalance uses,
    // computed for everyone at once instead of per customer.
    const debts = customerIds.length
      ? await this.prisma.sale.groupBy({
          by: ["customerId"],
          where: { organizationId, customerId: { in: customerIds } },
          _sum: { totalAmount: true, amountPaid: true },
        })
      : [];
    const debtById = new Map(
      debts.map((d) => [
        d.customerId,
        (d._sum.totalAmount?.toNumber() ?? 0) - (d._sum.amountPaid?.toNumber() ?? 0),
      ]),
    );

    const money = (value: number) => Number(value.toFixed(2));
    const retail = grouped.find((g) => g.customerId === null);
    let totalOutstanding = 0;

    const byCustomer: BusinessContextCustomerRowDto[] = grouped
      .filter((g): g is typeof g & { customerId: string } => g.customerId !== null)
      .map((g) => {
        const customer = byId.get(g.customerId);
        const revenue = g._sum.totalAmount?.toNumber() ?? 0;
        const salesCount = g._count._all;
        const outstanding = debtById.get(g.customerId) ?? 0;
        totalOutstanding += outstanding;
        return {
          customerId: g.customerId,
          name: customer?.name ?? "Клиент",
          revenue: money(revenue),
          salesCount,
          averageTicket: salesCount > 0 ? money(revenue / salesCount) : null,
          outstandingBalance: money(outstanding),
          creditLimit: customer?.creditLimit ? customer.creditLimit.toNumber() : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return {
      activeCount,
      totalOutstanding: money(totalOutstanding),
      retailRevenue: money(retail?._sum.totalAmount?.toNumber() ?? 0),
      retailSalesCount: retail?._count._all ?? 0,
      byCustomer,
    };
  }

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
