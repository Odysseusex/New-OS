import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { BusinessDirection, DirectionDto } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { audited, recordAudit } from "../audit/audit";
import { loadDirectionContext } from "./direction-context";
import { CreateDirectionDto, UpdateDirectionDto } from "./dto/direction.dto";

const FIELDS = (d: { name: string; responsible: string | null; isActive: boolean }) => ({ name: d.name, responsible: d.responsible, isActive: d.isActive });

// Справочник направлений бизнеса (ТЗ §2). The three system rows keep their automatic
// rules and cannot be archived or deleted; a person's direction is reached through a
// point's default direction and an expense booked to it.
@Injectable()
export class DirectionsService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string): Promise<DirectionDto[]> {
    const ctx = await loadDirectionContext(this.prisma, organizationId);
    const [rows, locations] = await Promise.all([
      this.prisma.direction.findMany({ where: { organizationId }, select: { id: true, responsible: true } }),
      this.prisma.location.findMany({ where: { organizationId, isActive: true }, select: { name: true, defaultDirectionId: true }, orderBy: { name: "asc" } }),
    ]);
    const responsible = new Map(rows.map((r) => [r.id, r.responsible]));
    return ctx.directions.map((d) => ({
      id: d.id,
      name: d.name,
      responsible: responsible.get(d.id) ?? null,
      systemKey: d.systemKey,
      isActive: d.isActive,
      locationNames: locations
        .filter((l) => (l.defaultDirectionId ?? ctx.system[BusinessDirection.RETAIL]) === d.id)
        .map((l) => l.name),
    }));
  }

  async create(organizationId: string, actorId: string, dto: CreateDirectionDto): Promise<DirectionDto> {
    const name = dto.name.trim();
    await this.assertNameFree(organizationId, name);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.direction.create({ data: { organizationId, name, responsible: dto.responsible?.trim() || null } });
      await recordAudit(tx, { organizationId, actorId, action: "direction.create", entityType: "Direction", entityId: row.id, after: FIELDS(row) });
      return row;
    });
    return this.one(organizationId, created.id);
  }

  async update(organizationId: string, actorId: string, id: string, dto: UpdateDirectionDto): Promise<DirectionDto> {
    const row = await this.prisma.direction.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException("Направление не найдено");
    if (dto.isActive === false && row.systemKey) throw new BadRequestException("Основное направление нельзя убрать в архив");
    if (dto.isActive === false && (await this.prisma.location.count({ where: { organizationId, defaultDirectionId: id, isActive: true } })) > 0) {
      throw new BadRequestException("Направление стоит по умолчанию у точки — сначала смените его у точки");
    }
    const name = dto.name?.trim();
    if (name && name !== row.name) await this.assertNameFree(organizationId, name);
    await audited(
      this.prisma,
      { organizationId, actorId, action: "direction.update", entityType: "Direction", entityId: id, before: FIELDS(row) },
      async (tx) => {
        const saved = await tx.direction.update({
          where: { id },
          data: {
            ...(name ? { name } : {}),
            ...(dto.responsible !== undefined ? { responsible: dto.responsible.trim() || null } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
        return { result: saved, after: FIELDS(saved) };
      },
    );
    return this.one(organizationId, id);
  }

  // Permanent delete: only a hand-made direction nothing points to.
  async remove(organizationId: string, actorId: string, id: string): Promise<{ deleted: true }> {
    const row = await this.prisma.direction.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException("Направление не найдено");
    if (row.systemKey) throw new BadRequestException("Основное направление удалить нельзя");
    const [locations, expenses] = await Promise.all([
      this.prisma.location.count({ where: { defaultDirectionId: id } }),
      this.prisma.expense.count({ where: { directionId: id } }),
    ]);
    if (locations > 0 || expenses > 0) throw new BadRequestException("Направление уже используется — уберите его в архив");
    await audited(
      this.prisma,
      { organizationId, actorId, action: "direction.delete", entityType: "Direction", entityId: id, before: FIELDS(row) },
      async (tx) => {
        await tx.direction.delete({ where: { id } });
        return { result: true };
      },
    );
    return { deleted: true };
  }

  private async one(organizationId: string, id: string): Promise<DirectionDto> {
    const found = (await this.list(organizationId)).find((d) => d.id === id);
    if (!found) throw new NotFoundException("Направление не найдено");
    return found;
  }

  private async assertNameFree(organizationId: string, name: string) {
    if (await this.prisma.direction.findFirst({ where: { organizationId, name }, select: { id: true } })) {
      throw new ConflictException("Направление с таким названием уже есть");
    }
  }
}
