import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CUSTOMER_MANAGE_ROLES, CUSTOMER_VIEW_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { CustomersService } from "./customers.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...CUSTOMER_VIEW_ROLES)
@Controller("customers")
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.findAllForOrganization(user.organizationId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.customersService.findOne(user.organizationId, id);
  }

  @Post()
  @Roles(...CUSTOMER_MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user.organizationId, dto);
  }
}
