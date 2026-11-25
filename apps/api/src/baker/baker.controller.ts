import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { BAKER_DAY_ROLES, BAKER_NOTE_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { BakerNotesService } from "./baker-notes.service";
import { BakerDayService } from "./baker-day.service";
import { AddIntakePhotoInput, BakerDayPostInput, CreateSupplierIntakeInput, ResolveSupplierIntakeInput, SaveBakerNoteInput } from "./baker.dto";
import { SupplierIntakesService } from "./supplier-intakes.service";

// «Накладные пекарей»: the phone screen (/baker) and the operator's «Накладные за день».
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...BAKER_NOTE_ROLES)
@Controller("baker")
export class BakerController {
  constructor(
    private notes: BakerNotesService,
    private days: BakerDayService,
    private intakes: SupplierIntakesService,
  ) {}

  // ── «Приход от поставщика» ──
  @Get("intakes")
  @Roles(...BAKER_DAY_ROLES)
  listIntakes(@CurrentUser() user: AuthenticatedUser, @Query("day") day?: string, @Query("pending") pending?: string) {
    return this.intakes.list(user, { day, pending });
  }

  @Get("intakes/mine")
  myIntakes(@CurrentUser() user: AuthenticatedUser) {
    return this.intakes.mine(user);
  }

  @Post("intakes")
  createIntake(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierIntakeInput) {
    return this.intakes.create(user, dto);
  }

  @Get("intakes/:id")
  intake(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.intakes.findOne(user, id);
  }

  @Post("intakes/:id/photos")
  addIntakePhoto(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: AddIntakePhotoInput) {
    return this.intakes.addPhoto(user, id, dto.dataUrl);
  }

  @Post("intakes/:id/send")
  sendIntake(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.intakes.send(user, id);
  }

  // The picture itself, to a signed-in user only (a supplier's paper is not for the open internet).
  @Get("intakes/:id/photos/:photoId")
  async intakePhoto(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("photoId") photoId: string, @Res() res: Response) {
    const photo = await this.intakes.photo(user, id, photoId);
    res.setHeader("Content-Type", photo.mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(photo.bytes);
  }

  @Post("intakes/:id/resolve")
  @Roles(...BAKER_DAY_ROLES)
  resolveIntake(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ResolveSupplierIntakeInput) {
    return this.intakes.resolve(user, id, dto);
  }

  @Get("catalog")
  catalog(@CurrentUser() user: AuthenticatedUser, @Query("sourceLocationId") sourceLocationId?: string) {
    return this.notes.catalog(user, sourceLocationId);
  }

  @Get("day")
  day(@CurrentUser() user: AuthenticatedUser, @Query("day") day?: string, @Query("sourceLocationId") sourceLocationId?: string) {
    return this.notes.day(user, day, sourceLocationId);
  }

  @Get("day/preview")
  @Roles(...BAKER_DAY_ROLES)
  preview(@CurrentUser() user: AuthenticatedUser, @Query("day") day: string, @Query("sourceLocationId") sourceLocationId?: string) {
    return this.days.preview(user, day, sourceLocationId);
  }

  @Post("day/post")
  @Roles(...BAKER_DAY_ROLES)
  post(@CurrentUser() user: AuthenticatedUser, @Body() dto: BakerDayPostInput) {
    return this.days.post(user, dto);
  }

  @Get("notes/previous")
  previous(
    @CurrentUser() user: AuthenticatedUser,
    @Query("kind") kind?: string,
    @Query("customerId") customerId?: string,
    @Query("locationId") locationId?: string,
    @Query("sourceLocationId") sourceLocationId?: string,
  ) {
    return this.notes.previous(user, { kind, customerId, locationId, sourceLocationId });
  }

  @Post("notes")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveBakerNoteInput) {
    return this.notes.create(user, dto);
  }

  @Get("notes/:id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notes.findOne(user, id);
  }

  @Put("notes/:id")
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SaveBakerNoteInput) {
    return this.notes.update(user, id, dto);
  }

  @Post("notes/:id/cancel")
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notes.cancel(user, id);
  }
}
