import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { BakerNoteStatus as PrismaStatus } from "@prisma/client";
import { CreatePrintJobRequestDto, PendingPrintJobDto, PRINT_JOB_MAX_NOTES, PRINT_JOB_TTL_MINUTES, PrintJobStatusDto } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { BAKER_NOTE_INCLUDE, BakerNotesService } from "./baker-notes.service";

// «Печать на ноутбуке выдачи»: someone picks notes on a phone or a computer, the door laptop's screen
// («Выдача накладных») asks every few seconds for open requests, claims one and prints it. Nothing here
// moves stock or money; a request only names notes.
@Injectable()
export class PrintJobsService {
  // When the door laptop last asked for work, per organization. In memory: the API is one process, and
  // after a restart the laptop is «seen» again within seconds.
  private readonly laptopSeen = new Map<string, Date>();

  constructor(
    private prisma: PrismaService,
    private notes: BakerNotesService,
  ) {}

  private freshSince(): Date {
    return new Date(Date.now() - PRINT_JOB_TTL_MINUTES * 60_000);
  }

  private status(organizationId: string, row: { id: string; createdAt: Date; claimedAt: Date | null }): PrintJobStatusDto {
    const seen = this.laptopSeen.get(organizationId);
    return { id: row.id, createdAt: row.createdAt.toISOString(), claimedAt: row.claimedAt?.toISOString() ?? null, laptopSeenAt: seen?.toISOString() ?? null };
  }

  async create(user: AuthenticatedUser, dto: CreatePrintJobRequestDto): Promise<PrintJobStatusDto> {
    const noteIds = [...new Set(dto.noteIds)];
    if (noteIds.length === 0 || noteIds.length > PRINT_JOB_MAX_NOTES) throw new BadRequestException(`Выберите от 1 до ${PRINT_JOB_MAX_NOTES} накладных`);
    const found = await this.prisma.bakerNote.count({
      where: { id: { in: noteIds }, organizationId: user.organizationId, status: { not: PrismaStatus.CANCELLED } },
    });
    if (found !== noteIds.length) throw new NotFoundException("Накладная не найдена или отменена");
    const row = await this.prisma.printJob.create({
      data: { organizationId: user.organizationId, noteIds, pack: dto.pack, createdById: user.id, createdByName: user.fullName },
    });
    return this.status(user.organizationId, row);
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<PrintJobStatusDto> {
    const row = await this.prisma.printJob.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException("Задание на печать не найдено");
    return this.status(user.organizationId, row);
  }

  laptop(user: AuthenticatedUser): { laptopSeenAt: string | null } {
    return { laptopSeenAt: this.laptopSeen.get(user.organizationId)?.toISOString() ?? null };
  }

  // The door laptop: open requests of the last hours, oldest first, each with its notes as they read now.
  async pending(user: AuthenticatedUser): Promise<PendingPrintJobDto[]> {
    this.laptopSeen.set(user.organizationId, new Date());
    const jobs = await this.prisma.printJob.findMany({
      where: { organizationId: user.organizationId, claimedAt: null, createdAt: { gte: this.freshSince() } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    if (jobs.length === 0) return [];
    const ids = [...new Set(jobs.flatMap((j) => j.noteIds))];
    const rows = await this.prisma.bakerNote.findMany({
      where: { id: { in: ids }, organizationId: user.organizationId, status: { not: PrismaStatus.CANCELLED } },
      include: BAKER_NOTE_INCLUDE,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return jobs.map((j) => ({
      id: j.id,
      pack: j.pack,
      createdByName: j.createdByName,
      createdAt: j.createdAt.toISOString(),
      notes: j.noteIds.flatMap((id) => {
        const row = byId.get(id);
        return row ? [this.notes.toDto(row, user)] : [];
      }),
    }));
  }

  // Exactly one claim wins (two laptops never print the same request twice).
  async claim(user: AuthenticatedUser, id: string): Promise<{ claimed: boolean }> {
    const res = await this.prisma.printJob.updateMany({
      where: { id, organizationId: user.organizationId, claimedAt: null },
      data: { claimedAt: new Date(), claimedById: user.id },
    });
    return { claimed: res.count === 1 };
  }
}
