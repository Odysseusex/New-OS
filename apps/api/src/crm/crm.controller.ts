import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CRM_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { CrmService } from "./crm.service";
import { CrmOrdersService } from "./crm-orders.service";
import { ClubChatService } from "../loyalty/club-chat.service";
import { CreateCrmContactDto, CrmChatBroadcastDto, CrmChatReplyDto, SaveCrmOrderDto } from "./dto/crm.dto";

// People's names, phones and habits: closed to everyone outside CRM_ROLES.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...CRM_ROLES)
@Controller("crm")
export class CrmController {
  constructor(
    private crm: CrmService,
    private orders: CrmOrdersService,
    private chat: ClubChatService,
  ) {}

  @Get("today")
  today(@CurrentUser() user: AuthenticatedUser) {
    return this.crm.today(user.organizationId);
  }

  @Post("contacts")
  recordContact(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCrmContactDto) {
    return this.crm.recordContact(user, dto);
  }

  @Get("members")
  list(@CurrentUser() user: AuthenticatedUser, @Query("q") q?: string, @Query("segment") segment?: string, @Query("sort") sort?: string) {
    return this.crm.list(user.organizationId, { q, segment, sort });
  }

  @Get("members/:id")
  profile(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.crm.profile(user.organizationId, id);
  }

  @Get("orders")
  listOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.list(user.organizationId);
  }

  @Post("orders")
  createOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveCrmOrderDto) {
    return this.orders.create(user, dto);
  }

  @Patch("orders/:id")
  updateOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SaveCrmOrderDto) {
    return this.orders.update(user, id, dto);
  }

  // ── chats with customers (the app) ────────────────────────────────────────

  @Get("chats")
  chats(@CurrentUser() user: AuthenticatedUser) {
    return this.chat.list(user.organizationId);
  }

  @Get("chats/unread")
  async chatsUnread(@CurrentUser() user: AuthenticatedUser) {
    return { unread: await this.chat.unreadForStaff(user.organizationId) };
  }

  // Whom a mass message can go to, and the ones already sent.
  @Get("chats/overview")
  chatsOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.chat.overview(user.organizationId);
  }

  @Post("chats/broadcast")
  chatsBroadcast(@CurrentUser() user: AuthenticatedUser, @Body() dto: CrmChatBroadcastDto) {
    return this.chat.broadcast(user, dto.audience, dto.text);
  }

  @Get("chats/:memberId")
  chatThread(@CurrentUser() user: AuthenticatedUser, @Param("memberId") memberId: string) {
    return this.chat.thread(user.organizationId, memberId);
  }

  @Post("chats/:memberId")
  chatReply(@CurrentUser() user: AuthenticatedUser, @Param("memberId") memberId: string, @Body() dto: CrmChatReplyDto) {
    return this.chat.reply(user, memberId, dto.text);
  }
}
