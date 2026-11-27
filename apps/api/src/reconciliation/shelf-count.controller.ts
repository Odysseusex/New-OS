import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { IsIn, IsNumber, IsString, Matches, MaxLength, Min } from "class-validator";
import { RECONCILIATION_ROLES, Role } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ShelfCountService } from "./shelf-count.service";

class AddShelfCountEntryInput {
  @IsString()
  @MaxLength(80)
  clientId!: string;

  @IsString()
  @MaxLength(80)
  deviceId!: string;

  @IsString()
  productId!: string;

  @IsIn(["ADD", "SET"])
  kind!: "ADD" | "SET";

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;
}

class ShelfCountDayInput {
  @IsString()
  locationId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}

// «Пересчёт» on the cashiers' phones. The counting routes are the shared phone login's own; the two
// «Сверка дня» routes (what the phones have done, «Вернуть на пересчёт») are the managers'.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ShelfCountController {
  constructor(private service: ShelfCountService) {}

  @Get("count")
  @Roles(Role.SHELF_COUNTER)
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.service.get(user);
  }

  @Post("count/entries")
  @Roles(Role.SHELF_COUNTER)
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddShelfCountEntryInput) {
    return this.service.addEntry(user, dto);
  }

  @Post("count/send")
  @Roles(Role.SHELF_COUNTER)
  send(@CurrentUser() user: AuthenticatedUser) {
    return this.service.send(user);
  }

  @Get("reconciliation/phone-count")
  @Roles(...RECONCILIATION_ROLES)
  status(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId: string | undefined, @Query("date") date: string) {
    return this.service.status(user, locationId, date);
  }

  @Post("reconciliation/phone-count/reopen")
  @Roles(...RECONCILIATION_ROLES)
  reopen(@CurrentUser() user: AuthenticatedUser, @Body() dto: ShelfCountDayInput) {
    return this.service.reopen(user, dto.locationId, dto.date);
  }
}
