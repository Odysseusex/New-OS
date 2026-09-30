import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { STOCKTAKE_APPROVE_ROLES, STOCKTAKE_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { StocktakeService } from "./stocktake.service";
import { CancelStocktakeDto, CreateStocktakeDto, UpdateStocktakeLineDto } from "./dto/stocktake.dto";

const ALL_STOCKTAKE_ROLES = [...new Set([...STOCKTAKE_MANAGE_ROLES, ...STOCKTAKE_APPROVE_ROLES])];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("stocktakes")
export class StocktakeController {
  constructor(private service: StocktakeService) {}

  @Get()
  @Roles(...ALL_STOCKTAKE_ROLES)
  list(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.service.findAll(user, locationId);
  }

  @Get(":id")
  @Roles(...ALL_STOCKTAKE_ROLES)
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.findOne(user, id);
  }

  @Post()
  @Roles(...STOCKTAKE_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStocktakeDto) {
    return this.service.create(user, dto);
  }

  @Put(":id/lines/:lineId")
  @Roles(...STOCKTAKE_MANAGE_ROLES)
  updateLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() dto: UpdateStocktakeLineDto,
  ) {
    return this.service.updateLine(user, id, lineId, dto);
  }

  @Post(":id/submit")
  @Roles(...STOCKTAKE_MANAGE_ROLES)
  submit(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.submit(user, id);
  }

  @Post(":id/reopen")
  @Roles(...ALL_STOCKTAKE_ROLES)
  reopen(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.reopen(user, id);
  }

  @Post(":id/approve")
  @Roles(...STOCKTAKE_APPROVE_ROLES)
  approve(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.approve(user, id);
  }

  @Post(":id/cancel")
  @Roles(...ALL_STOCKTAKE_ROLES)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CancelStocktakeDto) {
    return this.service.cancel(user, id, dto.reason);
  }
}
