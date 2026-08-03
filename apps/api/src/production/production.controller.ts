import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PRODUCTION_MANAGE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ProductionService } from "./production.service";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { UpdateBatchDto } from "./dto/update-batch.dto";
import { CancelBatchDto } from "./dto/cancel-batch.dto";
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

  @Patch(":id")
  @Roles(...PRODUCTION_MANAGE_ROLES)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateBatchDto,
  ) {
    return this.productionService.update(user, id, dto);
  }

  @Delete(":id")
  @Roles(...PRODUCTION_MANAGE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productionService.remove(user, id);
  }

  @Post(":id/start")
  @Roles(...PRODUCTION_MANAGE_ROLES)
  start(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.productionService.start(user, id);
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
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CancelBatchDto,
  ) {
    return this.productionService.cancel(user, id, dto);
  }
}
