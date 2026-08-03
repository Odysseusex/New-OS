import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { NotificationsService } from "./notifications.service";

@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getNotifications(user);
  }

  @Post(":key/dismiss")
  dismiss(@CurrentUser() user: AuthenticatedUser, @Param("key") key: string) {
    return this.notificationsService.dismiss(user, key);
  }

  @Post("dismiss-all")
  dismissAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.dismissAll(user);
  }
}
