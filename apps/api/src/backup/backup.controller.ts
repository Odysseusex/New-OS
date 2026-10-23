import { Controller, Get, Logger, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { Role } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { BackupService } from "./backup.service";

// The whole business in one file: the owner only (it holds every customer, every sale).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller("backup")
export class BackupController {
  private readonly logger = new Logger(BackupController.name);

  constructor(private service: BackupService) {}

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.service.status(user.organizationId);
  }

  @Get("export")
  async export(@CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res() res: Response) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="aramir-data-${date}.json"`);
    res.setHeader("Cache-Control", "no-store");
    let gone = false;
    req.on("close", () => {
      if (!res.writableEnded) gone = true;
    });
    try {
      await this.service.writeExport(user, res, () => gone);
      res.end();
    } catch (err) {
      this.logger.error(`Data export failed: ${err instanceof Error ? err.message : String(err)}`);
      // Headers are already sent: cut the connection so the file cannot pass for complete
      // (it has no closing marker anyway).
      res.destroy();
    }
  }
}
