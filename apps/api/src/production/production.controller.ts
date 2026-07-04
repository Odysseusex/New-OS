import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PRODUCTION_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ProductionService } from "./production.service";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { CompleteBatchDto } from "./dto/complete-batch.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("production/batches")
export class ProductionController {
  constructor(private productionService: ProductionService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId?: string) {
    return this.productionService.findAll(user, locationId);
  }

  @Post()
  @Roles(...PRODUCTION_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBatchDto) {
    return this.productionService.create(user, dto);
  }

  @Post(":id/complete")
  @Roles(...PRODUCTION_MANAGE_ROLES)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CompleteBatchDto,
  ) {
    return this.productionService.complete(user, id, dto);
  }

  @Post(":id/cancel")
  @Roles(...PRODUCTION_MANAGE_ROLES)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productionService.cancel(user, id);
  }
}
