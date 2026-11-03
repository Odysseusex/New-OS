import { BadRequestException, Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import { IsDateString, IsOptional, IsString } from "class-validator";
import { StockTurnoverDto, StockTurnoverLineDto } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../../auth/auth.types";
import { resolveLocationScope } from "../../common/location-scope";
import { categoryLabel } from "../../common/category-label";
import { round2 } from "../../common/money";
import { loadCostHistory } from "./cost-history";
import { replayCosts } from "./replay";

const round3 = (v: number) => Math.round(v * 1000) / 1000;

// Оборотно-сальдовая ведомость по товарам: for each product, what was there at
// the start, what came in, what went out and what is there at the end — in
// quantity and in money. The money is the network's moving average walked by
// method «Б» (cost-history.ts + replay.ts, the same walk as the month-end
// correction), so the statement and the correction never disagree. The closing
// quantity at `to` is the stock on that date («остатки на дату»).
//
// For the whole network a transfer between points is neither in nor out; for
// one point it is (at the average of its moment). Read-only.
@Injectable()
export class StockTurnoverService {
  constructor(private prisma: PrismaService) {}

  async turnover(organizationId: string, from: Date, to: Date, locationId: string | null): Promise<StockTurnoverDto> {
    if (!(from.getTime() <= to.getTime())) throw new BadRequestException("Начало периода позже его конца");
    const [history, categories] = await Promise.all([
      loadCostHistory(this.prisma, organizationId, to),
      this.prisma.category.findMany({ where: { organizationId }, include: { parent: true } }),
    ]);
    const rows = new Map<string, { oq: number; ov: number; iq: number; iv: number; xq: number; xv: number }>();
    const rowOf = (id: string) => {
      let r = rows.get(id);
      if (!r) {
        r = { oq: 0, ov: 0, iq: 0, iv: 0, xq: 0, xv: 0 };
        rows.set(id, r);
      }
      return r;
    };
    let unvalued = 0;
    const fromMs = from.getTime();

    replayCosts({
      flows: history.flows,
      batchUntracked: history.batchUntracked,
      startingAverage: history.startingAverage,
      from: fromMs,
      to: to.getTime(),
      onFlow: (flow, unit) => {
        const meta = history.meta.get(flow.order);
        if (!meta) return;
        if (locationId ? meta.locationId !== locationId : meta.group === "TRANSFER") return;
        // The direction is in the meta; MOVE and returned-PURCHASE flows also sign their quantity.
        const quantity = Math.abs(flow.quantity);
        const sign = meta.sign;
        if (unit === null) unvalued += 1;
        const value = unit !== null ? round2(quantity * unit) : 0;
        const r = rowOf(flow.productId);
        if (flow.at < fromMs) {
          r.oq += sign * quantity;
          r.ov += sign * value;
        } else if (sign > 0) {
          r.iq += quantity;
          r.iv += value;
        } else {
          r.xq += quantity;
          r.xv += value;
        }
      },
    });

    const categoryName = new Map(categories.map((c) => [c.id, categoryLabel(c)]));
    const lines: StockTurnoverLineDto[] = [];
    for (const p of history.products) {
      const r = rows.get(p.id);
      if (!r) continue;
      const line: StockTurnoverLineDto = {
        productId: p.id,
        productName: p.name,
        unit: p.unit,
        productType: p.type,
        categoryName: p.categoryId ? categoryName.get(p.categoryId) ?? null : null,
        openingQuantity: round3(r.oq),
        openingValue: round2(r.ov),
        inQuantity: round3(r.iq),
        inValue: round2(r.iv),
        outQuantity: round3(r.xq),
        outValue: round2(r.xv),
        closingQuantity: round3(r.oq + r.iq - r.xq),
        closingValue: round2(r.ov + r.iv - r.xv),
      };
      const empty = [line.openingQuantity, line.inQuantity, line.outQuantity, line.closingQuantity, line.closingValue].every((v) => Math.abs(v) < 0.0005);
      if (!empty) lines.push(line);
    }
    lines.sort((a, b) => (a.categoryName ?? "яяя").localeCompare(b.categoryName ?? "яяя", "ru") || a.productName.localeCompare(b.productName, "ru"));
    const sum = (k: "openingValue" | "inValue" | "outValue" | "closingValue") => round2(lines.reduce((s, l) => s + l[k], 0));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      locationId,
      lines,
      totals: { openingValue: sum("openingValue"), inValue: sum("inValue"), outValue: sum("outValue"), closingValue: sum("closingValue") },
      unvaluedFlows: unvalued,
    };
  }
}

class StockTurnoverQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}

// Open to every role that sees the stock (like Склад → Движения); a user tied
// to one point sees that point only.
@UseGuards(JwtAuthGuard)
@Controller("inventory/turnover")
export class StockTurnoverController {
  constructor(private turnover: StockTurnoverService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Query() query: StockTurnoverQueryDto) {
    const locationId = resolveLocationScope(user, query.locationId) ?? null;
    return this.turnover.turnover(user.organizationId, new Date(query.from), new Date(query.to), locationId);
  }
}
