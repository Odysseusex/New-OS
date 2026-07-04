import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { LocationsService } from "./locations.service";
import { AuthenticatedUser } from "../auth/auth.types";

@UseGuards(JwtAuthGuard)
@Controller("locations")
export class LocationsController {
  constructor(private locationsService: LocationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.locationsService.findAllForOrganization(user.organizationId);
  }
}
