import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { HARD_DELETE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ClassificationService } from "./classification.service";
import { ClassificationApplyDto, ClassificationPreviewDto, ClassificationRevertDto } from "./dto/classification.dto";

// Owner/admin only: a classification re-files many products at once.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...HARD_DELETE_ROLES)
@Controller("classification")
export class ClassificationController {
  constructor(private classificationService: ClassificationService) {}

  // Writes nothing: what a file WOULD do.
  @Post("preview")
  preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClassificationPreviewDto) {
    return this.classificationService.preview(user, dto);
  }

  @Post("apply")
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClassificationApplyDto) {
    return this.classificationService.apply(user, dto);
  }

  @Get("batches")
  batches(@CurrentUser() user: AuthenticatedUser) {
    return this.classificationService.listBatches(user.organizationId);
  }

  @Post("batches/:id/revert")
  revert(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ClassificationRevertDto) {
    return this.classificationService.revert(user, id, dto);
  }
}
