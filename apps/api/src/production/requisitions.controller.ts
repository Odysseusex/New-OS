import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { MATERIAL_REQUISITION_CREATE_ROLES, MATERIAL_REQUISITION_POST_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { MaterialRequisitionsService } from "./requisitions.service";
import { CreateRequisitionInput, UpdateRequisitionInput } from "./dto/requisition.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("production/requisitions")
export class MaterialRequisitionsController {
  constructor(private requisitions: MaterialRequisitionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.requisitions.list(user, from, to);
  }

  // Сверка выдачи: issued by requisitions vs consumed by completed batches, per raw material.
  @Get("issue-report")
  issueReport(@CurrentUser() user: AuthenticatedUser, @Query("locationId") locationId: string, @Query("from") from: string, @Query("to") to: string) {
    return this.requisitions.issueReport(user, locationId, from, to);
  }

  // The day's tasks at the workshop and their need by the recipes.
  @Get("need")
  @Roles(...MATERIAL_REQUISITION_CREATE_ROLES)
  need(
    @CurrentUser() user: AuthenticatedUser,
    @Query("fromLocationId") fromLocationId: string,
    @Query("toLocationId") toLocationId: string,
    @Query("date") date: string,
    @Query("batchIds") batchIds?: string,
  ) {
    return this.requisitions.need(user, {
      fromLocationId,
      toLocationId,
      date,
      batchIds: batchIds === undefined ? undefined : batchIds.split(",").filter(Boolean),
    });
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.requisitions.findOne(user, id);
  }

  @Post()
  @Roles(...MATERIAL_REQUISITION_CREATE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRequisitionInput) {
    return this.requisitions.create(user, dto);
  }

  @Put(":id")
  @Roles(...MATERIAL_REQUISITION_CREATE_ROLES)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateRequisitionInput) {
    return this.requisitions.update(user, id, dto);
  }

  @Post(":id/post")
  @Roles(...MATERIAL_REQUISITION_POST_ROLES)
  post(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.requisitions.post(user, id);
  }

  @Delete(":id")
  @Roles(...MATERIAL_REQUISITION_CREATE_ROLES)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.requisitions.remove(user, id);
  }
}
