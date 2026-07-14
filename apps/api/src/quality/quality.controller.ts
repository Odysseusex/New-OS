import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { QUALITY_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { QualityService } from "./quality.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...QUALITY_VIEW_ROLES)
@Controller("quality")
export class QualityController {
  constructor(private qualityService: QualityService) {}

  @Get("write-offs")
  findWriteOffs(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.qualityService.findWriteOffs(
      user,
      locationId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get("summary")
  getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("locationId") locationId?: string,
  ) {
    return this.qualityService.getSummary(user, new Date(from), new Date(to), locationId);
  }
}
