import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

// The sandbox («Песочница») gets full access to its own organization, but a few
// things in this app are not organization-scoped and reach the REAL business:
// the whole-database download, the fiscal cash register, the WhatsApp / customer
// Telegram accounts. Those check this. Whether an organization is a sandbox
// never changes after it is created, so the answer is cached.

const known = new Map<string, boolean>();

export async function isDemoOrganization(prisma: PrismaService, organizationId: string): Promise<boolean> {
  const cached = known.get(organizationId);
  if (cached !== undefined) return cached;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { demoParentId: true } });
  const demo = !!org?.demoParentId;
  if (org) known.set(organizationId, demo);
  return demo;
}

export async function assertNotDemo(prisma: PrismaService, organizationId: string): Promise<void> {
  if (await isDemoOrganization(prisma, organizationId)) {
    throw new BadRequestException("В песочнице недоступно: это действие затрагивает настоящую компанию");
  }
}

// Every sandbox, for queries that must leave them out (a customer found by phone).
export async function demoOrganizationIds(prisma: PrismaService): Promise<string[]> {
  return (await prisma.organization.findMany({ where: { demoParentId: { not: null } }, select: { id: true } })).map((o) => o.id);
}
