import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { PinLoginDto, TillApprovalBodyDto } from "./dto/till-pin.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "./auth.types";
import { CurrentUserDto } from "@bakery-os/shared";

@Controller("auth")
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
  ) {}

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Post("pin-login")
  pinLogin(@CurrentUser() user: AuthenticatedUser, @Body() dto: PinLoginDto) {
    return this.authService.pinLogin(user, dto.pin);
  }

  @UseGuards(JwtAuthGuard)
  @Post("till-approval")
  tillApproval(@CurrentUser() user: AuthenticatedUser, @Body() dto: TillApprovalBodyDto) {
    return this.authService.tillApproval(user, dto.pin, dto.action, dto.locationId, dto.detail);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser): Promise<CurrentUserDto> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
    });

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      title: user.title,
      organizationId: user.organizationId,
      organization: { id: organization.id, name: organization.name, isDemo: !!organization.demoParentId },
      locationId: user.locationId,
    };
  }
}
