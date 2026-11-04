import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { BANK_IMPORT_ROLES } from "@bakery-os/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { BankStatementsService } from "./bank-statements.service";
import { BankProfileInput, KeywordRuleInput, PostBankLinesInput, UploadBankStatementInput } from "./dto/bank.dto";

// Финансы → «Выписки». Everything here reads or writes the money in the books,
// so the whole controller is for the people who answer for them.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...BANK_IMPORT_ROLES)
@Controller("bank-statements")
export class BankStatementsController {
  constructor(private statements: BankStatementsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.statements.list(user);
  }

  // Declared before ":id" so the literal paths are not read as a statement id.
  @Get("keyword-rules")
  keywordRules(@CurrentUser() user: AuthenticatedUser) {
    return this.statements.keywordRules(user);
  }

  @Post("keyword-rules")
  addKeywordRule(@CurrentUser() user: AuthenticatedUser, @Body() dto: KeywordRuleInput) {
    return this.statements.addKeywordRule(user, dto);
  }

  @Delete("keyword-rules/:id")
  removeKeywordRule(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.statements.removeKeywordRule(user, id);
  }

  @Get("profiles")
  profiles(@CurrentUser() user: AuthenticatedUser) {
    return this.statements.profiles(user);
  }

  @Put("profiles")
  saveProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: BankProfileInput) {
    return this.statements.saveProfile(user, dto as never);
  }

  @Post()
  upload(@CurrentUser() user: AuthenticatedUser, @Body() dto: UploadBankStatementInput) {
    return this.statements.upload(user, dto);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.statements.get(user, id);
  }

  @Post(":id/post")
  post(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: PostBankLinesInput) {
    return this.statements.post(user, id, dto.lines);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.statements.remove(user, id);
  }
}
