import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ArrayMaxSize, IsArray } from "class-validator";
import { REFERENCE_IMPORT_MAX_ROWS, REFERENCE_KINDS, ReferenceKind } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ReferenceDataService } from "./reference-data.service";

export class ReferenceImportBodyDto {
  // Rows of cells as the browser read them; checked cell by cell in the service.
  @IsArray()
  @ArrayMaxSize(REFERENCE_IMPORT_MAX_ROWS + 50)
  grid!: unknown[];
}

function kindOf(raw: string): ReferenceKind {
  if (!REFERENCE_KINDS.includes(raw as ReferenceKind)) throw new BadRequestException("Неизвестный справочник");
  return raw as ReferenceKind;
}

// Roles are per directory (who may create its entries by hand), checked in the service.
@UseGuards(JwtAuthGuard)
@Controller("reference-data")
export class ReferenceDataController {
  constructor(private service: ReferenceDataService) {}

  @Get(":kind/export")
  export(@CurrentUser() user: AuthenticatedUser, @Param("kind") kind: string) {
    return this.service.export(user, kindOf(kind));
  }

  // Writes nothing.
  @Post(":kind/preview")
  preview(@CurrentUser() user: AuthenticatedUser, @Param("kind") kind: string, @Body() body: ReferenceImportBodyDto) {
    return this.service.preview(user, kindOf(kind), body.grid);
  }

  @Post(":kind/apply")
  apply(@CurrentUser() user: AuthenticatedUser, @Param("kind") kind: string, @Body() body: ReferenceImportBodyDto) {
    return this.service.apply(user, kindOf(kind), body.grid);
  }
}
