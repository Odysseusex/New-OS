import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LoyaltyConsent, LoyaltyMember, Prisma } from "@prisma/client";
import {
  formatKzPhone,
  KZ_PHONE_INVALID_MESSAGE,
  LOYALTY_CONSENT_CHANNELS,
  LOYALTY_LIST_LIMIT,
  LoyaltyConsentChannel,
  LoyaltyConsentPurpose,
  LoyaltyConsentSource,
  LoyaltyConsentStateDto,
  LoyaltyImportPreviewDto,
  LoyaltyImportPreviewRowDto,
  LoyaltyImportResultDto,
  LoyaltyImportRowStatus,
  LoyaltyLookupDto,
  LoyaltyMemberDetailDto,
  LoyaltyMemberDto,
  LoyaltyMemberListDto,
  LoyaltyMemberStatus,
  normalizeKzPhone,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { auditFields, recordAudit, recordAuditMany } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { LoyaltyPointsService } from "./loyalty-points.service";
import {
  LoyaltyImportApplyRequestDto,
  LoyaltyImportRowDto,
  MergeLoyaltyMembersDto,
  RecordLoyaltyConsentDto,
  RegisterLoyaltyMemberDto,
  UpdateLoyaltyMemberDto,
} from "./dto/loyalty.dto";

type MemberWithConsents = LoyaltyMember & { consents: LoyaltyConsent[] };

const CONSENTS_IN_ORDER = { consents: { orderBy: [{ recordedAt: "asc" as const }, { id: "asc" as const }] } };
const MEMBER_FIELDS = ["phone", "name", "note", "status", "mergedIntoId"] as const;

// A merge chain is flattened on every merge, so one hop is the norm; the cap
// only guards against a cycle nobody should be able to create.
const MAX_MERGE_HOPS = 10;

// The latest row per purpose/channel is the customer's current decision.
export function consentState(consents: Pick<LoyaltyConsent, "purpose" | "channel" | "granted">[]): LoyaltyConsentStateDto {
  const state: LoyaltyConsentStateDto = {
    personalData: false,
    marketing: { WHATSAPP: false, TELEGRAM: false, SMS: false },
  };
  for (const c of consents) {
    if (c.purpose === LoyaltyConsentPurpose.PERSONAL_DATA) state.personalData = c.granted;
    else if (c.channel) state.marketing[c.channel as LoyaltyConsentChannel] = c.granted;
  }
  return state;
}

const YES = new Set(["да", "д", "yes", "y", "1", "+", "true", "согласен", "согласна", "есть", "x", "х", "✓", "v"]);
const isYes = (value: string | undefined) => YES.has((value ?? "").trim().toLowerCase());
const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

@Injectable()
export class LoyaltyService {
  constructor(
    private prisma: PrismaService,
    private points: LoyaltyPointsService,
  ) {}

  // ── Till: find by phone ───────────────────────────────────────────────────

  async lookup(organizationId: string, rawPhone: string): Promise<LoyaltyLookupDto> {
    const phone = this.requirePhone(rawPhone);
    let member = await this.prisma.loyaltyMember.findUnique({
      where: { organizationId_phone: { organizationId, phone } },
      include: CONSENTS_IN_ORDER,
    });
    for (let hop = 0; member?.mergedIntoId && hop < MAX_MERGE_HOPS; hop += 1) {
      member = await this.prisma.loyaltyMember.findFirst({
        where: { id: member.mergedIntoId, organizationId },
        include: CONSENTS_IN_ORDER,
      });
    }
    return { phone, member: member ? await this.withBalance(organizationId, member) : null };
  }

  async register(user: AuthenticatedUser, dto: RegisterLoyaltyMemberDto): Promise<LoyaltyMemberDto> {
    const phone = this.requirePhone(dto.phone);
    if (!dto.personalDataConsent) {
      throw new BadRequestException("Без согласия клиента на обработку персональных данных зарегистрировать его нельзя");
    }
    this.refuseImportSource(dto.source);
    const existing = await this.prisma.loyaltyMember.findUnique({
      where: { organizationId_phone: { organizationId: user.organizationId, phone } },
    });
    if (existing) throw new ConflictException(this.existsMessage(existing));

    const channels = [...new Set(dto.marketingChannels ?? [])];
    const recordedAt = new Date();
    try {
      const member = await this.prisma.$transaction(async (tx) => {
        const created = await tx.loyaltyMember.create({
          data: {
            organizationId: user.organizationId,
            phone,
            name: blankToNull(dto.name),
            note: blankToNull(dto.note),
            createdById: user.id,
          },
        });
        await tx.loyaltyConsent.createMany({
          data: [
            this.consentRow(user, created.id, LoyaltyConsentPurpose.PERSONAL_DATA, null, true, dto.source, recordedAt, null),
            ...channels.map((channel) =>
              this.consentRow(user, created.id, LoyaltyConsentPurpose.MARKETING, channel, true, dto.source, recordedAt, null),
            ),
          ],
        });
        const saved = await tx.loyaltyMember.findUniqueOrThrow({ where: { id: created.id }, include: CONSENTS_IN_ORDER });
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          action: "loyaltyMember.create",
          entityType: "LoyaltyMember",
          entityId: created.id,
          after: { ...auditFields(saved, MEMBER_FIELDS), consents: consentState(saved.consents), source: dto.source },
        });
        return saved;
      });
      return this.toDto(member, 0);
    } catch (err) {
      // Two tills registering the same number at the same moment: the unique index decides.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("Клиент с этим номером уже зарегистрирован");
      }
      throw err;
    }
  }

  async recordConsent(user: AuthenticatedUser, memberId: string, dto: RecordLoyaltyConsentDto): Promise<LoyaltyMemberDto> {
    const isMarketing = dto.purpose === LoyaltyConsentPurpose.MARKETING;
    if (isMarketing && !dto.channel) throw new BadRequestException("Укажите канал рассылки");
    if (!isMarketing && dto.channel) throw new BadRequestException("Канал указывается только для рекламных рассылок");
    this.refuseImportSource(dto.source);

    const member = await this.getMember(user.organizationId, memberId);
    this.refuseMerged(member);
    const before = consentState(member.consents);
    const current = isMarketing ? before.marketing[dto.channel as LoyaltyConsentChannel] : before.personalData;
    if (current === dto.granted) throw new BadRequestException("Это решение клиента уже записано");
    if (isMarketing && dto.granted && !before.personalData) {
      throw new BadRequestException("Сначала оформите согласие на обработку персональных данных");
    }

    const recordedAt = new Date();
    const note = blankToNull(dto.note);
    const rows = [this.consentRow(user, member.id, dto.purpose, dto.channel ?? null, dto.granted, dto.source, recordedAt, note)];
    let status = member.status as LoyaltyMemberStatus;
    if (!isMarketing && !dto.granted) {
      // Without consent to keep their data there is nothing to send them either:
      // every channel still open is closed by explicit rows, so the history says so.
      for (const channel of LOYALTY_CONSENT_CHANNELS) {
        if (before.marketing[channel]) {
          rows.push(
            this.consentRow(user, member.id, LoyaltyConsentPurpose.MARKETING, channel, false, dto.source, recordedAt,
              "Вместе с отзывом согласия на обработку персональных данных"),
          );
        }
      }
      status = LoyaltyMemberStatus.WITHDRAWN;
    } else if (!isMarketing && dto.granted) {
      status = LoyaltyMemberStatus.ACTIVE;
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyConsent.createMany({ data: rows });
      if (status !== member.status) {
        await tx.loyaltyMember.update({ where: { id: member.id }, data: { status } });
      }
      const after = await tx.loyaltyMember.findUniqueOrThrow({ where: { id: member.id }, include: CONSENTS_IN_ORDER });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "loyaltyMember.consent",
        entityType: "LoyaltyMember",
        entityId: member.id,
        before: { status: member.status, consents: before },
        after: { status: after.status, consents: consentState(after.consents), source: dto.source },
        reason: note,
      });
      return after;
    });
    return this.withBalance(user.organizationId, saved);
  }

  // ── Management ────────────────────────────────────────────────────────────

  // Searched in the database, not client-side like the product pickers: the
  // retail base can grow to tens of thousands of people's phone numbers, which
  // should not all be shipped to a browser to filter one name.
  async list(organizationId: string, query: { q?: string; status?: string }): Promise<LoyaltyMemberListDto> {
    const status = Object.values(LoyaltyMemberStatus).includes(query.status as LoyaltyMemberStatus)
      ? (query.status as LoyaltyMemberStatus)
      : undefined;
    const q = query.q?.trim() ?? "";
    const digits = q.replace(/\D/g, "");
    const search: Prisma.LoyaltyMemberWhereInput[] = [];
    if (q) search.push({ name: { contains: q, mode: "insensitive" } });
    if (digits.length >= 3) {
      // «8701…» is how people type a number; stored numbers start «+7701…».
      const national = digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits;
      search.push({ phone: { contains: national } });
    }
    const where: Prisma.LoyaltyMemberWhereInput = {
      organizationId,
      ...(status ? { status } : { status: { not: LoyaltyMemberStatus.MERGED } }),
      ...(search.length ? { OR: search } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.loyaltyMember.findMany({ where, include: CONSENTS_IN_ORDER, orderBy: { createdAt: "desc" }, take: LOYALTY_LIST_LIMIT }),
      this.prisma.loyaltyMember.count({ where }),
    ]);
    const balances = await this.points.balances(organizationId, items.map((m) => m.id));
    return { items: items.map((m) => this.toDto(m, balances.get(m.id) ?? 0)), total };
  }

  async findOne(organizationId: string, memberId: string): Promise<LoyaltyMemberDetailDto> {
    const exists = await this.prisma.loyaltyMember.findFirst({ where: { id: memberId, organizationId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Клиент не найден");
    // Opening the card writes off expired points, so its history says so.
    await this.points.settleOutside(organizationId, memberId);
    const member = await this.prisma.loyaltyMember.findFirst({
      where: { id: memberId, organizationId },
      include: { ...CONSENTS_IN_ORDER, mergedFrom: { orderBy: { mergedAt: "asc" } } },
    });
    if (!member) throw new NotFoundException("Клиент не найден");
    const [balances, pointsHistory] = await Promise.all([
      this.points.balances(organizationId, [member.id]),
      this.points.history(organizationId, member.id),
    ]);
    return {
      ...this.toDto(member, balances.get(member.id) ?? 0),
      pointsHistory,
      history: [...member.consents].reverse().map((c) => ({
        id: c.id,
        purpose: c.purpose as LoyaltyConsentPurpose,
        channel: c.channel as LoyaltyConsentChannel | null,
        granted: c.granted,
        source: c.source as LoyaltyConsentSource,
        recordedByName: c.recordedByName,
        recordedAt: c.recordedAt.toISOString(),
        note: c.note,
      })),
      mergedFrom: member.mergedFrom.map((m) => ({
        id: m.id,
        phone: m.phone,
        name: m.name,
        mergedAt: m.mergedAt?.toISOString() ?? null,
      })),
    };
  }

  async update(user: AuthenticatedUser, memberId: string, dto: UpdateLoyaltyMemberDto): Promise<LoyaltyMemberDto> {
    const member = await this.getMember(user.organizationId, memberId);
    this.refuseMerged(member);
    const data: Prisma.LoyaltyMemberUpdateInput = {};
    if (dto.name !== undefined) data.name = blankToNull(dto.name);
    if (dto.note !== undefined) data.note = blankToNull(dto.note);
    const saved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.loyaltyMember.update({ where: { id: member.id }, data, include: CONSENTS_IN_ORDER });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "loyaltyMember.update",
        entityType: "LoyaltyMember",
        entityId: member.id,
        before: auditFields(member, ["name", "note"] as const),
        after: auditFields(updated, ["name", "note"] as const),
      });
      return updated;
    });
    return this.withBalance(user.organizationId, saved);
  }

  // One-way, like a stock void: the duplicate stays in the database (its consent
  // history is still the proof of what was agreed on that number) and its phone
  // keeps leading to the primary record. Consents are NOT carried over — an
  // agreement to receive WhatsApp on one number is not an agreement for another.
  async merge(user: AuthenticatedUser, dto: MergeLoyaltyMembersDto): Promise<LoyaltyMemberDetailDto> {
    const reason = dto.reason.trim();
    if (reason.length < 5) throw new BadRequestException("Укажите причину объединения (не короче 5 символов)");
    if (dto.primaryId === dto.duplicateId) throw new BadRequestException("Нельзя объединить запись саму с собой");
    const [primary, duplicate] = await Promise.all([
      this.getMember(user.organizationId, dto.primaryId),
      this.getMember(user.organizationId, dto.duplicateId),
    ]);
    this.refuseMerged(primary);
    this.refuseMerged(duplicate);

    const mergedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Conditional updates: whichever of two simultaneous merges lands second finds nothing to change.
      const folded = await tx.loyaltyMember.updateMany({
        where: { id: duplicate.id, status: { not: LoyaltyMemberStatus.MERGED } },
        data: { status: LoyaltyMemberStatus.MERGED, mergedIntoId: primary.id, mergedAt },
      });
      const kept = await tx.loyaltyMember.updateMany({
        where: { id: primary.id, status: { not: LoyaltyMemberStatus.MERGED } },
        data: {
          name: primary.name ?? duplicate.name,
          note: primary.note ?? duplicate.note,
        },
      });
      if (folded.count !== 1 || kept.count !== 1) {
        throw new ConflictException("Одна из записей уже объединена — обновите страницу");
      }
      // Points move with the person, each lot keeping its own expiry.
      const pointsMoved = await this.points.transferOnMerge(tx, user, duplicate.id, primary.id);
      // Earlier duplicates of the duplicate now lead straight to the primary.
      await tx.loyaltyMember.updateMany({
        where: { organizationId: user.organizationId, mergedIntoId: duplicate.id },
        data: { mergedIntoId: primary.id },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "loyaltyMember.merge",
        entityType: "LoyaltyMember",
        entityId: duplicate.id,
        before: {
          duplicate: { ...auditFields(duplicate, MEMBER_FIELDS), consents: consentState(duplicate.consents) },
          primary: { id: primary.id, ...auditFields(primary, MEMBER_FIELDS) },
        },
        after: { status: LoyaltyMemberStatus.MERGED, mergedIntoId: primary.id, pointsMoved },
        reason,
      });
    });
    return this.findOne(user.organizationId, primary.id);
  }

  // ── Import ────────────────────────────────────────────────────────────────
  // Only ADDS people. A number already in the base is skipped untouched: a file
  // must not silently grant or withdraw anything for an existing customer.

  async previewImport(organizationId: string, rows: LoyaltyImportRowDto[]): Promise<LoyaltyImportPreviewDto> {
    const parsed = rows.map((row, i) => ({ row, line: i + 1, phone: normalizeKzPhone(row.phone) }));
    const phones = parsed.map((p) => p.phone).filter((p): p is string => p !== null);
    const existing = phones.length
      ? await this.prisma.loyaltyMember.findMany({ where: { organizationId, phone: { in: phones } }, select: { phone: true } })
      : [];
    const inBase = new Set(existing.map((e) => e.phone));
    const seen = new Set<string>();

    const out: LoyaltyImportPreviewRowDto[] = parsed.map(({ row, line, phone }) => {
      let status: LoyaltyImportRowStatus;
      if (!phone) status = LoyaltyImportRowStatus.INVALID_PHONE;
      else if (seen.has(phone)) status = LoyaltyImportRowStatus.DUPLICATE_IN_FILE;
      else if (inBase.has(phone)) status = LoyaltyImportRowStatus.EXISTS;
      else if (!isYes(row.consent)) status = LoyaltyImportRowStatus.NO_CONSENT;
      else status = LoyaltyImportRowStatus.NEW;
      if (phone) seen.add(phone);
      return {
        line,
        rawPhone: row.phone,
        phone,
        name: blankToNull(row.name),
        marketingChannels: LOYALTY_CONSENT_CHANNELS.filter((c) => isYes(row[c.toLowerCase() as "whatsapp" | "telegram" | "sms"])),
        status,
      };
    });
    const newCount = out.filter((r) => r.status === LoyaltyImportRowStatus.NEW).length;
    return { rows: out, newCount, skippedCount: out.length - newCount };
  }

  async applyImport(user: AuthenticatedUser, dto: LoyaltyImportApplyRequestDto): Promise<LoyaltyImportResultDto> {
    const note = dto.note.trim();
    if (note.length < 3) throw new BadRequestException("Укажите, откуда согласия в файле (например, «анкеты 2025»)");
    // Re-judged here, not trusted from the preview: the base may have changed since.
    const preview = await this.previewImport(user.organizationId, dto.rows);
    const fresh = preview.rows.filter((r) => r.status === LoyaltyImportRowStatus.NEW);
    if (fresh.length === 0) throw new BadRequestException("В файле нет новых клиентов с согласием");
    const notes = new Map(dto.rows.map((r, i) => [i + 1, blankToNull(r.note)]));
    const recordedAt = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.loyaltyMember.createManyAndReturn({
          data: fresh.map((r) => ({
            organizationId: user.organizationId,
            phone: r.phone as string,
            name: r.name,
            note: notes.get(r.line) ?? null,
            createdById: user.id,
          })),
          select: { id: true, phone: true },
        });
        const idByPhone = new Map(created.map((m) => [m.phone, m.id]));
        await tx.loyaltyConsent.createMany({
          data: fresh.flatMap((r) => {
            const memberId = idByPhone.get(r.phone as string) as string;
            return [
              this.consentRow(user, memberId, LoyaltyConsentPurpose.PERSONAL_DATA, null, true, LoyaltyConsentSource.IMPORT, recordedAt, note),
              ...r.marketingChannels.map((channel) =>
                this.consentRow(user, memberId, LoyaltyConsentPurpose.MARKETING, channel, true, LoyaltyConsentSource.IMPORT, recordedAt, note),
              ),
            ];
          }),
        });
        await recordAuditMany(
          tx,
          fresh.map((r) => ({
            organizationId: user.organizationId,
            actorId: user.id,
            action: "loyaltyMember.import" as const,
            entityType: "LoyaltyMember",
            entityId: idByPhone.get(r.phone as string) as string,
            after: { phone: r.phone, name: r.name, personalData: true, marketing: r.marketingChannels, line: r.line },
            reason: note,
          })),
        );
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("Пока шёл импорт, часть номеров добавили вручную — проверьте файл ещё раз");
      }
      throw err;
    }
    return { created: fresh.length, skipped: preview.rows.length - fresh.length };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private requirePhone(raw: string | undefined): string {
    const phone = normalizeKzPhone(raw);
    if (!phone) throw new BadRequestException(KZ_PHONE_INVALID_MESSAGE);
    return phone;
  }

  private refuseImportSource(source: LoyaltyConsentSource) {
    if (source === LoyaltyConsentSource.IMPORT) {
      throw new BadRequestException("Источник «Импорт» ставится только при загрузке файла");
    }
  }

  private refuseMerged(member: LoyaltyMember) {
    if (member.status === LoyaltyMemberStatus.MERGED) {
      throw new BadRequestException("Эта запись объединена с другой — откройте основную запись клиента");
    }
  }

  private existsMessage(member: LoyaltyMember): string {
    const who = `${formatKzPhone(member.phone)}${member.name ? ` (${member.name})` : ""}`;
    if (member.status === LoyaltyMemberStatus.WITHDRAWN) {
      return `Клиент ${who} уже есть, но отозвал согласие — оформите согласие заново в его карточке`;
    }
    if (member.status === LoyaltyMemberStatus.MERGED) {
      return `Номер ${who} уже есть и объединён с другой записью клиента`;
    }
    return `Клиент ${who} уже зарегистрирован`;
  }

  private async getMember(organizationId: string, memberId: string): Promise<MemberWithConsents> {
    const member = await this.prisma.loyaltyMember.findFirst({ where: { id: memberId, organizationId }, include: CONSENTS_IN_ORDER });
    if (!member) throw new NotFoundException("Клиент не найден");
    return member;
  }

  private consentRow(
    user: AuthenticatedUser,
    memberId: string,
    purpose: LoyaltyConsentPurpose,
    channel: LoyaltyConsentChannel | null,
    granted: boolean,
    source: LoyaltyConsentSource,
    recordedAt: Date,
    note: string | null,
  ): Prisma.LoyaltyConsentCreateManyInput {
    return {
      organizationId: user.organizationId,
      memberId,
      purpose,
      channel,
      granted,
      source,
      recordedById: user.id,
      recordedByName: user.fullName,
      recordedAt,
      note,
    };
  }

  private async withBalance(organizationId: string, member: MemberWithConsents): Promise<LoyaltyMemberDto> {
    const balances = await this.points.balances(organizationId, [member.id]);
    return this.toDto(member, balances.get(member.id) ?? 0);
  }

  private toDto(member: MemberWithConsents, pointsBalance: number): LoyaltyMemberDto {
    return {
      id: member.id,
      phone: member.phone,
      name: member.name,
      note: member.note,
      status: member.status as LoyaltyMemberStatus,
      mergedIntoId: member.mergedIntoId,
      consents: consentState(member.consents),
      pointsBalance,
      createdAt: member.createdAt.toISOString(),
    };
  }
}
