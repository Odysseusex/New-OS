import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { BAKER_DAY_ROLES, BAKER_NOTE_ROLES, BAKER_PRINT_ROLES, BAKER_AUTO_POST_ROLES, BAKER_TRIP_FORCE_ROLES, Role } from "@bakery-os/shared";

// Reading a day / one note: the bakers and the door laptop («Выдача накладных»).
const NOTE_READ_ROLES = [...new Set([...BAKER_NOTE_ROLES, ...BAKER_PRINT_ROLES])];
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { BakerNotesService } from "./baker-notes.service";
import { BakerDayService } from "./baker-day.service";
import { AddIntakePhotoInput, BakerDayPostInput, CreatePrintJobInput, MarkNotesPrintedInput, CreateSupplierIntakeInput, ResolveSupplierIntakeInput, SaveBakerNoteInput, BakerAutoPostSettingsInput, StaffPushSubscribeInput, StaffPushUnsubscribeInput } from "./baker.dto";
import { SupplierIntakesService } from "./supplier-intakes.service";
import { PrintJobsService } from "./print-jobs.service";
import { BakerTripsService } from "./baker-trips.service";
import { isPushEndpoint, StaffPushService } from "./staff-push.service";
import { BakerAutoPostService } from "./baker-auto-post.service";

// «Накладные пекарей»: the phone screen (/baker) and the operator's «Накладные за день».
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...BAKER_NOTE_ROLES)
@Controller("baker")
export class BakerController {
  constructor(
    private notes: BakerNotesService,
    private days: BakerDayService,
    private intakes: SupplierIntakesService,
    private printJobs: PrintJobsService,
    private trips: BakerTripsService,
    private staffPush: StaffPushService,
    private auto: BakerAutoPostService,
  ) {}

  // ── «Проводить накладные сразу» ──
  @Get("settings")
  @Roles(...BAKER_DAY_ROLES)
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.auto.settings(user);
  }

  @Put("settings")
  @Roles(...BAKER_AUTO_POST_ROLES)
  saveSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: BakerAutoPostSettingsInput) {
    return this.auto.saveSettings(user, dto);
  }

  // ── «Рейс» ── (bakers press «Рейс готов»; the day roles watch and may launch without waiting)
  @Get("trip")
  trip(@CurrentUser() user: AuthenticatedUser) {
    this.auto.kick();
    return this.trips.state(user);
  }

  @Post("trip/ready")
  tripReady(@CurrentUser() user: AuthenticatedUser) {
    return this.trips.confirm(user);
  }

  @Post("trip/withdraw")
  tripWithdraw(@CurrentUser() user: AuthenticatedUser) {
    return this.trips.withdraw(user);
  }

  @Post("trip/launch")
  @Roles(...BAKER_TRIP_FORCE_ROLES)
  tripLaunch(@CurrentUser() user: AuthenticatedUser) {
    return this.trips.force(user);
  }

  // ── Notifications on a baker's phone ──
  @Get("push/key")
  pushKey() {
    return this.staffPush.publicKey();
  }

  @Post("push/subscribe")
  pushSubscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: StaffPushSubscribeInput) {
    if (!isPushEndpoint(dto.endpoint)) throw new BadRequestException("Неизвестный адрес уведомлений");
    return this.staffPush.subscribe(user.organizationId, user.id, dto);
  }

  @Post("push/unsubscribe")
  pushUnsubscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: StaffPushUnsubscribeInput) {
    return this.staffPush.unsubscribe(user.id, dto.endpoint);
  }

  // ── «Печать на ноутбуке выдачи» ── (named routes before «print-jobs/:id»)
  @Post("print-jobs")
  @Roles(...BAKER_PRINT_ROLES)
  createPrintJob(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePrintJobInput) {
    return this.printJobs.create(user, dto);
  }

  @Get("print-jobs/laptop")
  @Roles(...BAKER_PRINT_ROLES)
  printLaptop(@CurrentUser() user: AuthenticatedUser) {
    return this.printJobs.laptop(user);
  }

  // Only the door laptop's own login prints, so an owner's screen open elsewhere never takes the job.
  @Get("print-jobs/pending")
  @Roles(Role.DISPATCHER)
  pendingPrintJobs(@CurrentUser() user: AuthenticatedUser) {
    this.auto.kick();
    return this.printJobs.pending(user);
  }

  @Post("print-jobs/:id/claim")
  @Roles(Role.DISPATCHER)
  claimPrintJob(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.printJobs.claim(user, id);
  }

  @Get("print-jobs/:id")
  @Roles(...BAKER_PRINT_ROLES)
  printJob(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.printJobs.findOne(user, id);
  }

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
  @Roles(...NOTE_READ_ROLES)
  day(@CurrentUser() user: AuthenticatedUser, @Query("day") day?: string, @Query("sourceLocationId") sourceLocationId?: string) {
    this.auto.kick();
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

  @Post("notes/print-marks")
  @Roles(...BAKER_PRINT_ROLES)
  markPrinted(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkNotesPrintedInput) {
    return this.notes.markPrinted(user, dto.noteIds);
  }

  @Post("notes")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveBakerNoteInput) {
    return this.notes.create(user, dto);
  }

  @Get("notes/:id")
  @Roles(...NOTE_READ_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notes.findOne(user, id);
  }

  @Put("notes/:id")
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SaveBakerNoteInput) {
    // A sent note is edited; a posted one is corrected by documents for the difference.
    return this.auto.save(user, id, dto);
  }

  @Post("notes/:id/cancel")
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notes.cancel(user, id);
  }
}
