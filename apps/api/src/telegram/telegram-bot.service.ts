import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Telegraf, Markup } from "telegraf";
import type { Update } from "telegraf/types";
import {
  BREAK_EVEN_STATUS_LABELS_RU,
  BreakEvenStatus,
  CASH_ACCOUNT_TYPE_LABELS_RU,
  CASH_MOVEMENT_INFLOW_TYPES,
  CASH_MOVEMENT_TYPE_LABELS_RU,
  CashMovementType,
  CUSTOMER_VIEW_ROLES,
  EXPENSE_STATUS_LABELS_RU,
  FINANCE_VIEW_ROLES,
  INVENTORY_MANAGE_ROLES,
  ORG_WIDE_ROLES,
  PAYMENT_METHOD_LABELS_RU,
  PAYMENT_RECORD_ROLES,
  PaymentMethod,
  PRODUCTION_BATCH_STATUS_LABELS_RU,
  PRODUCTION_MANAGE_ROLES,
  ProductionBatchStatus,
  ProductType,
  SALE_CREATE_ROLES,
  WriteOffReason,
  WRITE_OFF_REASON_LABELS_RU,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { InventoryService } from "../inventory/inventory.service";
import { SalesService } from "../sales/sales.service";
import { LocationsService } from "../locations/locations.service";
import { ProductsService } from "../products/products.service";
import { CustomersService } from "../customers/customers.service";
import { ProductionService } from "../production/production.service";
import { RecipesService } from "../recipes/recipes.service";
import { FinanceService } from "../finance/finance.service";
import { CashAccountsService } from "../finance/cash-accounts.service";
import { CashMovementsService } from "../finance/cash-movements.service";
import { TelegramAuthResolver } from "./telegram-auth.resolver";
import { TelegramLinkService } from "./telegram-link.service";
import { TelegramPendingActionService } from "./telegram-pending-action.service";
import { TelegramChatStateService } from "./telegram-chat-state.service";
import { escapeHtml, formatDate, formatDateTime, formatMoney, formatQuantity } from "./telegram-format";

const MAX_LIST_ITEMS = 40;

interface StockActionPayload {
  locationId: string;
  productId: string;
  productName: string;
  quantity: number;
  reason?: string;
  writeOffReason?: WriteOffReason;
}

interface PaymentActionPayload {
  saleId: string;
  amount: number;
  customerName: string;
}

interface ProductionCreatePayload {
  locationId: string;
  recipeId: string;
  productName: string;
  plannedQuantity: number;
  unit: string;
}

interface ProductionBatchPayload {
  batchId: string;
  productName: string;
  // Set for "complete" only — the real produced quantity, which drives
  // ingredient consumption inside ProductionService.complete().
  actualQuantity?: number;
}

interface SaleItemDraft {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface SaleCreatePayload {
  locationId: string;
  customerId: string | null;
  customerName: string;
  paymentMethod: PaymentMethod;
  // Only meaningful for a customer sale — a retail sale is always settled in
  // full (SalesService.create forces it), so the bot never asks.
  paidInFull: boolean;
  items: SaleItemDraft[];
  totalAmount: number;
}

// The one place the bot talks to Telegram. Every write action funnels
// through InventoryService/SalesService — this class only builds menus,
// walks a chat through a short wizard, and stages+confirms the resulting
// call via TelegramPendingActionService. No business logic (validation,
// stock math, permission rules beyond re-checking the same role arrays the
// HTTP controllers use) lives here.
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf | null = null;

  constructor(
    private authResolver: TelegramAuthResolver,
    private linkService: TelegramLinkService,
    private pendingActions: TelegramPendingActionService,
    private chatState: TelegramChatStateService,
    private inventoryService: InventoryService,
    private salesService: SalesService,
    private locationsService: LocationsService,
    private productsService: ProductsService,
    private customersService: CustomersService,
    private financeService: FinanceService,
    private cashAccountsService: CashAccountsService,
    private cashMovementsService: CashMovementsService,
    private productionService: ProductionService,
    private recipesService: RecipesService,
  ) {}

  async onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled");
      return;
    }
    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);

    // Telegraf lazily fetches getMe() on the first incoming update if
    // botInfo isn't already cached — and that fetch happens inside
    // Telegraf's own handleUpdate, before any of our handlers (and their
    // try/catch) ever run. Warming it here at boot means a bad token or
    // network problem surfaces once, clearly, in the startup log — not as
    // an unexplained 500 on someone's first /start.
    try {
      this.bot.botInfo = await this.bot.telegram.getMe();
      this.logger.log(`Telegram bot ready: @${this.bot.botInfo.username}`);
    } catch (err) {
      this.logger.error(
        "Telegram getMe() failed at startup — check TELEGRAM_BOT_TOKEN",
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  isEnabled(): boolean {
    return this.bot !== null;
  }

  async handleUpdate(update: Update): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.handleUpdate(update);
    } catch (err) {
      // Last-resort net: anything Telegraf throws before dispatching to our
      // own handlers (e.g. its internal getMe() call) bypasses every
      // try/catch inside registerHandlers. Catching here means a hiccup
      // never turns into a raw 500 back to Telegram — it's logged and
      // swallowed, same posture as withAuth's own catch block.
      this.logger.error("Unhandled Telegram update error", err instanceof Error ? err.stack : String(err));
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.telegram.sendMessage(chatId, text, { parse_mode: "HTML" });
  }

  private registerHandlers(bot: Telegraf) {
    bot.start(async (ctx) => this.onStart(ctx));
    bot.help(async (ctx) => this.reply(ctx, this.helpText()));
    bot.command("stock", async (ctx) => this.withAuth(ctx, (user) => this.showStockMenu(ctx, user)));
    bot.command("sales", async (ctx) => this.withAuth(ctx, (user) => this.showSalesMenu(ctx, user)));

    bot.action("m", async (ctx) => this.withAuth(ctx, (user) => this.showMainMenu(ctx, user)));
    bot.action("s:m", async (ctx) => this.withAuth(ctx, (user) => this.showStockMenu(ctx, user)));
    bot.action("s:lv", async (ctx) => this.withAuth(ctx, (user) => this.showStockLevels(ctx, user, false)));
    bot.action("s:lw", async (ctx) => this.withAuth(ctx, (user) => this.showStockLevels(ctx, user, true)));
    bot.action("s:h", async (ctx) => this.withAuth(ctx, (user) => this.showStockHistory(ctx, user)));
    bot.action("s:r:0", async (ctx) => this.withAuth(ctx, (user) => this.startStockWizard(ctx, user, "receive")));
    bot.action("s:w:0", async (ctx) => this.withAuth(ctx, (user) => this.startStockWizard(ctx, user, "writeoff")));
    bot.action(/^s:r:l:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickStockLocation(ctx, user, "receive", ctx.match[1])),
    );
    bot.action(/^s:w:l:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickStockLocation(ctx, user, "writeoff", ctx.match[1])),
    );
    bot.action(/^s:r:p:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickStockProduct(ctx, user, "receive", ctx.match[1])),
    );
    bot.action(/^s:w:p:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickStockProduct(ctx, user, "writeoff", ctx.match[1])),
    );
    bot.action("s:r:sk", async (ctx) => this.withAuth(ctx, (user) => this.skipComment(ctx, user, "receive")));
    bot.action("s:w:sk", async (ctx) => this.withAuth(ctx, (user) => this.skipComment(ctx, user, "writeoff")));
    bot.action(/^s:w:wr:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickWriteOffReason(ctx, user, ctx.match[1] as WriteOffReason)),
    );

    bot.action("l:m", async (ctx) => this.withAuth(ctx, (user) => this.showSalesMenu(ctx, user)));
    bot.action("l:t", async (ctx) => this.withAuth(ctx, (user) => this.showSalesToday(ctx, user)));
    bot.action(/^l:p:(\d+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.showSalesPeriod(ctx, user, Number(ctx.match[1]))),
    );
    bot.action("l:lm", async (ctx) => this.withAuth(ctx, (user) => this.showSalesLocationPicker(ctx, user)));
    bot.action(/^l:tl:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.showSalesToday(ctx, user, ctx.match[1])),
    );

    // New-sale wizard — the only multi-item ("cart") flow in the bot: every
    // other wizard collects one row, this one loops товар -> количество
    // until the user says Готово.
    bot.action("l:n", async (ctx) => this.withAuth(ctx, (user) => this.startSaleWizard(ctx, user)));
    bot.action(/^l:n:l:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickSaleLocation(ctx, user, ctx.match[1])),
    );
    bot.action(/^l:n:c:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickSaleCustomer(ctx, user, ctx.match[1])),
    );
    bot.action("l:n:add", async (ctx) => this.withAuth(ctx, (user) => this.showSaleProductPicker(ctx, user)));
    bot.action(/^l:n:p:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickSaleProduct(ctx, user, ctx.match[1])),
    );
    bot.action("l:n:done", async (ctx) => this.withAuth(ctx, (user) => this.showSalePaymentMethodPicker(ctx, user)));
    bot.action(/^l:n:pm:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickSalePaymentMethod(ctx, user, ctx.match[1] as PaymentMethod)),
    );
    bot.action(/^l:n:pd:([01])$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.finishSaleWizard(ctx, user, ctx.match[1] === "1")),
    );

    bot.command("production", async (ctx) => this.withAuth(ctx, (user) => this.showProductionMenu(ctx, user)));
    bot.action("pr:m", async (ctx) => this.withAuth(ctx, (user) => this.showProductionMenu(ctx, user)));
    bot.action("pr:l", async (ctx) => this.withAuth(ctx, (user) => this.showActiveBatches(ctx, user)));
    bot.action("pr:t", async (ctx) => this.withAuth(ctx, (user) => this.showTodayProduced(ctx, user)));
    bot.action(/^pr:d:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.showBatchDetail(ctx, user, ctx.match[1])),
    );
    bot.action("pr:n", async (ctx) => this.withAuth(ctx, (user) => this.startBatchWizard(ctx, user)));
    bot.action(/^pr:n:l:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickBatchLocation(ctx, user, ctx.match[1])),
    );
    bot.action(/^pr:n:r:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickBatchRecipe(ctx, user, ctx.match[1])),
    );
    bot.action(/^pr:s:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.stageBatchStart(ctx, user, ctx.match[1])),
    );
    bot.action(/^pr:c:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.askBatchActualQuantity(ctx, user, ctx.match[1])),
    );

    bot.command("customers", async (ctx) => this.withAuth(ctx, (user) => this.showCustomersMenu(ctx, user)));
    bot.action("cl:m", async (ctx) => this.withAuth(ctx, (user) => this.showCustomersMenu(ctx, user)));
    bot.action("cl:l", async (ctx) => this.withAuth(ctx, (user) => this.showCustomerList(ctx, user)));
    bot.action(/^cl:d:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.showCustomerDetail(ctx, user, ctx.match[1])),
    );
    bot.action(/^cl:pm:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.showPaymentSalePicker(ctx, user, ctx.match[1])),
    );
    bot.action(/^cl:p:(.+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.pickSaleForPayment(ctx, user, ctx.match[1])),
    );

    bot.command("finance", async (ctx) => this.withAuth(ctx, (user) => this.showFinanceMenu(ctx, user)));
    bot.action("fn:m", async (ctx) => this.withAuth(ctx, (user) => this.showFinanceMenu(ctx, user)));
    bot.action("fn:acc", async (ctx) => this.withAuth(ctx, (user) => this.showAccounts(ctx, user)));
    bot.action("fn:cf", async (ctx) => this.withAuth(ctx, (user) => this.showCashFlow(ctx, user)));
    bot.action("fn:exp", async (ctx) => this.withAuth(ctx, (user) => this.showExpenses(ctx, user)));
    bot.action("fn:pnl", async (ctx) => this.withAuth(ctx, (user) => this.showPnl(ctx, user)));
    bot.action("fn:ar", async (ctx) => this.withAuth(ctx, (user) => this.showAccountsReceivablePayable(ctx, user)));
    bot.action("fn:be", async (ctx) => this.withAuth(ctx, (user) => this.showBreakEven(ctx, user)));

    bot.command("analytics", async (ctx) => this.withAuth(ctx, (user) => this.showAnalyticsMenu(ctx, user)));
    bot.action("an:m", async (ctx) => this.withAuth(ctx, (user) => this.showAnalyticsMenu(ctx, user)));
    bot.action(/^an:d:(\d+)$/, async (ctx) =>
      this.withAuth(ctx, (user) => this.showDemandAnalysis(ctx, user, Number(ctx.match[1]))),
    );
    bot.action("an:lw", async (ctx) => this.withAuth(ctx, (user) => this.showStockLevels(ctx, user, true)));

    bot.action(/^c:(.+)$/, async (ctx) => this.withAuth(ctx, (user) => this.confirmAction(ctx, user, ctx.match[1])));
    bot.action(/^x:(.+)$/, async (ctx) => this.withAuth(ctx, (user) => this.cancelAction(ctx, user, ctx.match[1])));

    bot.on("text", async (ctx) => this.withAuth(ctx, (user) => this.onText(ctx, user, ctx.message.text)));
  }

  // ---- auth / linking ----------------------------------------------------

  // Unlike every other handler, /start can't go through withAuth (there's
  // no linked user yet on a first run) — so it needs its own try/catch, or
  // an exception here (e.g. a DB hiccup) fails completely silently: no
  // reply, no log, nothing visibly wrong from the chat's side.
  private async onStart(ctx: any) {
    try {
      const chatId = String(ctx.chat.id);
      const payload = (ctx.startPayload as string | undefined)?.trim();

      const existing = await this.authResolver.resolve(chatId);
      if (existing) {
        await this.showMainMenu(ctx, existing);
        return;
      }

      if (!payload) {
        await this.reply(
          ctx,
          "Этот аккаунт ещё не привязан к ArAmir OS.\n\n" +
            "Откройте <b>Настройки → Telegram</b> в ArAmir OS, получите код и отправьте его сюда командой:\n" +
            "<code>/start КОД</code>",
        );
        return;
      }

      const result = await this.linkService.consumeToken(payload, chatId);
      if (!result.ok) {
        const reason = result.reason === "expired" ? "Код истёк, получите новый в Настройках." : "Неверный код.";
        await this.reply(ctx, `⚠️ Не удалось привязать аккаунт. ${reason}`);
        return;
      }

      const user = await this.authResolver.resolve(chatId);
      if (!user) return;
      await this.reply(ctx, `✅ Аккаунт привязан: <b>${escapeHtml(user.fullName)}</b>`);
      await this.showMainMenu(ctx, user);
    } catch (err) {
      this.logger.error("Telegram /start error", err instanceof Error ? err.stack : String(err));
      await this.reply(ctx, "⚠️ Произошла ошибка. Попробуйте ещё раз чуть позже.").catch(() => {});
    }
  }

  // `ctx.answerCbQuery` is a method Telegraf attaches to every context
  // regardless of update type — `if (ctx.answerCbQuery)` is therefore
  // always true and never actually detects "was this a button tap". Calling
  // it on a plain message throws *synchronously* (Telegraf's own
  // Context.assert), before a Promise even exists to attach `.catch()` to —
  // so that guard-and-catch pattern silently didn't protect anything. The
  // only correct check is the update's actual `callbackQuery` field.
  private async ackCallback(ctx: any): Promise<void> {
    if (!ctx.callbackQuery) return;
    try {
      await ctx.answerCbQuery();
    } catch {
      // e.g. the callback is too old to acknowledge — harmless
    }
  }

  // Telegram never disables old inline keyboards — every button a wizard
  // ever sent stays tappable forever, even after that wizard finished or
  // was abandoned. Chat state is single-slot per chat (one "current step"),
  // so tapping a stale button from an earlier flow resumes with whatever
  // (possibly unrelated, possibly empty) data currently sits there instead
  // of what that button's own flow originally collected. Every callback
  // handler that continues a wizard from chat state must go through this —
  // it's what turned a stale "Что производим?" tap into a batch created
  // with locationId literally the string "undefined" (Prisma FK violation)
  // instead of a clean "start over" message.
  private async requireStep(
    ctx: any,
    chatId: string,
    ...expectedSteps: string[]
  ): Promise<Record<string, unknown> | null> {
    const state = await this.chatState.get(chatId);
    if (!state?.step || !expectedSteps.includes(state.step)) {
      await this.reply(ctx, "Этот шаг уже не актуален — сценарий завершён или начат заново. Начните действие заново из меню.");
      return null;
    }
    return (state.data as Record<string, unknown>) ?? {};
  }

  private async withAuth(ctx: any, handler: (user: AuthenticatedUser) => Promise<void>) {
    try {
      const chatId = String(ctx.chat?.id ?? ctx.from?.id);
      const user = await this.authResolver.resolve(chatId);
      if (!user) {
        await this.reply(
          ctx,
          "Аккаунт не привязан. Отправьте /start и следуйте инструкции, чтобы подключить Telegram в Настройках ArAmir OS.",
        );
        await this.ackCallback(ctx);
        return;
      }
      await handler(user);
    } catch (err) {
      this.logger.error("Telegram handler error", err instanceof Error ? err.stack : String(err));
      await this.reply(ctx, "⚠️ Произошла ошибка. Попробуйте ещё раз.");
      await this.ackCallback(ctx);
    }
  }

  private helpText(): string {
    return (
      "<b>ArAmir OS — Telegram</b>\n\n" +
      "Основной способ работы — кнопки меню.\n\n" +
      "Команды:\n" +
      "/start — главное меню\n" +
      "/stock — раздел «Склад»\n" +
      "/sales — раздел «Продажи»\n" +
      "/customers — раздел «Клиенты»\n" +
      "/finance — раздел «Финансы»\n" +
      "/production — раздел «Производство»\n" +
      "/analytics — раздел «Аналитика»\n" +
      "/help — эта справка"
    );
  }

  // ---- menus ---------------------------------------------------------------

  private async showMainMenu(ctx: any, user: AuthenticatedUser) {
    const rows = [
      [Markup.button.callback("📦 Склад", "s:m")],
      [Markup.button.callback("💰 Продажи", "l:m")],
    ];
    if (CUSTOMER_VIEW_ROLES.includes(user.role)) {
      rows.push([Markup.button.callback("👥 Клиенты", "cl:m")]);
    }
    if (FINANCE_VIEW_ROLES.includes(user.role)) {
      rows.push([Markup.button.callback("💵 Финансы", "fn:m")]);
    }
    if (PRODUCTION_MANAGE_ROLES.includes(user.role) || ORG_WIDE_ROLES.includes(user.role)) {
      rows.push([Markup.button.callback("🏭 Производство", "pr:m")]);
    }
    rows.push([Markup.button.callback("📊 Аналитика", "an:m")]);
    await this.replyOrEdit(
      ctx,
      `Здравствуйте, <b>${escapeHtml(user.fullName)}</b>. Выберите раздел:`,
      Markup.inlineKeyboard(rows),
    );
    await this.ackCallback(ctx);
  }

  private async showStockMenu(ctx: any, user: AuthenticatedUser) {
    const rows = [
      [Markup.button.callback("📋 Остатки", "s:lv")],
      [Markup.button.callback("⚠️ Низкие остатки", "s:lw")],
      [Markup.button.callback("📜 История", "s:h")],
    ];
    if (INVENTORY_MANAGE_ROLES.includes(user.role)) {
      rows.push([Markup.button.callback("➕ Приход", "s:r:0"), Markup.button.callback("➖ Списание", "s:w:0")]);
    }
    rows.push([Markup.button.callback("⬅️ Назад", "m")]);
    await this.replyOrEdit(ctx, "📦 <b>Склад</b>", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  private async showSalesMenu(ctx: any, user: AuthenticatedUser) {
    const rows = [
      [Markup.button.callback("📅 Сегодня", "l:t")],
      [Markup.button.callback("🗓 7 дней", "l:p:7"), Markup.button.callback("🗓 30 дней", "l:p:30")],
    ];
    if (ORG_WIDE_ROLES.includes(user.role)) {
      rows.push([Markup.button.callback("🏬 По точке", "l:lm")]);
    }
    if (SALE_CREATE_ROLES.includes(user.role)) {
      rows.push([Markup.button.callback("➕ Новая продажа", "l:n")]);
    }
    rows.push([Markup.button.callback("⬅️ Назад", "m")]);
    await this.replyOrEdit(ctx, "💰 <b>Продажи</b>", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  // ---- stock: read ----------------------------------------------------------

  private async showStockLevels(ctx: any, user: AuthenticatedUser, lowOnly: boolean) {
    const levels = await this.inventoryService.getStockLevels(user);
    const filtered = lowOnly ? levels.filter((l) => l.isLow) : levels;
    if (filtered.length === 0) {
      await this.reply(ctx, lowOnly ? "Низких остатков нет ✅" : "Остатков нет.");
      await this.ackCallback(ctx);
      return;
    }
    const shown = filtered.slice(0, MAX_LIST_ITEMS);
    const lines = shown.map((l) => {
      const mark = l.isLow ? "⚠️ " : "";
      return `${mark}<b>${escapeHtml(l.productName)}</b> (${escapeHtml(l.locationName)}): ${formatQuantity(l.quantity)} / мин. ${formatQuantity(l.minQuantity)}`;
    });
    const title = lowOnly ? "⚠️ <b>Низкие остатки</b>" : "📋 <b>Остатки</b>";
    const truncated = filtered.length > MAX_LIST_ITEMS ? `\n\n…показаны первые ${MAX_LIST_ITEMS} из ${filtered.length}` : "";
    await this.reply(ctx, `${title}\n\n${lines.join("\n")}${truncated}`);
    await this.ackCallback(ctx);
  }

  private async showStockHistory(ctx: any, user: AuthenticatedUser) {
    const movements = await this.inventoryService.getMovements(user);
    const shown = movements.slice(0, 15);
    if (shown.length === 0) {
      await this.reply(ctx, "Движений пока нет.");
      await this.ackCallback(ctx);
      return;
    }
    const lines = shown.map((m) => {
      const sign = m.quantity >= 0 ? "+" : "";
      return `${formatDateTime(m.createdAt)} — <b>${escapeHtml(m.productName)}</b> (${escapeHtml(m.locationName)}): ${sign}${formatQuantity(m.quantity)}`;
    });
    await this.reply(ctx, `📜 <b>Последние движения</b>\n\n${lines.join("\n")}`);
    await this.ackCallback(ctx);
  }

  // ---- stock: receive / write-off wizard ------------------------------------

  private async startStockWizard(ctx: any, user: AuthenticatedUser, kind: "receive" | "writeoff") {
    if (!INVENTORY_MANAGE_ROLES.includes(user.role)) {
      await this.reply(ctx, "У вас нет прав на эту операцию.");
      await this.ackCallback(ctx);
      return;
    }
    const chatId = String(ctx.chat.id);
    if (ORG_WIDE_ROLES.includes(user.role)) {
      await this.chatState.set(chatId, user.id, `${kind}_location`, {});
      const locations = await this.locationsService.findAllForOrganization(user.organizationId);
      const rows = locations
        .slice(0, MAX_LIST_ITEMS)
        .map((l) => [Markup.button.callback(l.name, `s:${kind === "receive" ? "r" : "w"}:l:${l.id}`)]);
      rows.push([Markup.button.callback("⬅️ Назад", "s:m")]);
      await this.reply(ctx, "Выберите точку:", Markup.inlineKeyboard(rows));
    } else {
      await this.chatState.set(chatId, user.id, `${kind}_product`, { locationId: user.locationId });
      await this.showProductPicker(ctx, user, kind);
    }
    await this.ackCallback(ctx);
  }

  private async pickStockLocation(ctx: any, user: AuthenticatedUser, kind: "receive" | "writeoff", locationId: string) {
    const chatId = String(ctx.chat.id);
    if (!(await this.requireStep(ctx, chatId, `${kind}_location`))) {
      await this.ackCallback(ctx);
      return;
    }
    await this.chatState.set(chatId, user.id, `${kind}_product`, { locationId });
    await this.showProductPicker(ctx, user, kind);
    await this.ackCallback(ctx);
  }

  private async showProductPicker(ctx: any, user: AuthenticatedUser, kind: "receive" | "writeoff") {
    const products = (await this.productsService.findAllForOrganization(user.organizationId)).filter(
      (p) => p.trackInventory,
    );
    const prefix = kind === "receive" ? "s:r:p:" : "s:w:p:";
    const rows = products.slice(0, MAX_LIST_ITEMS).map((p) => [Markup.button.callback(p.name, `${prefix}${p.id}`)]);
    rows.push([Markup.button.callback("⬅️ Назад", "s:m")]);
    await this.reply(ctx, "Выберите товар:", Markup.inlineKeyboard(rows));
  }

  private async pickStockProduct(ctx: any, user: AuthenticatedUser, kind: "receive" | "writeoff", productId: string) {
    const chatId = String(ctx.chat.id);
    const data = await this.requireStep(ctx, chatId, `${kind}_product`);
    if (!data) {
      await this.ackCallback(ctx);
      return;
    }
    const products = await this.productsService.findAllForOrganization(user.organizationId);
    const product = products.find((p) => p.id === productId);
    if (!product) {
      await this.reply(ctx, "Товар не найден.");
      await this.ackCallback(ctx);
      return;
    }
    await this.chatState.set(chatId, user.id, `${kind}_qty`, { ...data, productId, productName: product.name });
    await this.reply(ctx, `Введите количество (${product.unit}) для «${escapeHtml(product.name)}»:`);
    await this.ackCallback(ctx);
  }

  private async onText(ctx: any, user: AuthenticatedUser, text: string) {
    const chatId = String(ctx.chat.id);
    const state = await this.chatState.get(chatId);
    if (!state?.step) return; // not in a wizard — ignore free text, buttons are the primary UI

    const data = (state.data as Record<string, unknown>) ?? {};

    if (state.step === "receive_qty" || state.step === "writeoff_qty") {
      const quantity = Number(text.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        await this.reply(ctx, "Введите положительное число, например 12.5");
        return;
      }
      const kind = state.step === "receive_qty" ? "receive" : "writeoff";
      if (kind === "receive") {
        await this.chatState.set(chatId, user.id, "receive_comment", { ...data, quantity });
        await this.reply(
          ctx,
          "Комментарий (необязательно). Отправьте текст или нажмите «Пропустить».",
          Markup.inlineKeyboard([[Markup.button.callback("Пропустить", "s:r:sk")]]),
        );
      } else {
        await this.chatState.set(chatId, user.id, "writeoff_reason", { ...data, quantity });
        const rows = Object.values(WriteOffReason).map((reason) => [
          Markup.button.callback(WRITE_OFF_REASON_LABELS_RU[reason], `s:w:wr:${reason}`),
        ]);
        await this.reply(ctx, "Причина списания:", Markup.inlineKeyboard(rows));
      }
      return;
    }

    if (state.step === "receive_comment") {
      await this.finishStockWizard(ctx, user, "receive", { ...data, reason: text });
      return;
    }

    if (state.step === "writeoff_comment") {
      await this.finishStockWizard(ctx, user, "writeoff", { ...data, reason: text });
      return;
    }

    if (state.step === "batch_qty" || state.step === "batch_complete_qty") {
      const quantity = Number(text.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        await this.reply(ctx, "Введите положительное число, например 40");
        return;
      }
      await this.chatState.clear(chatId);

      if (state.step === "batch_qty") {
        const payload: ProductionCreatePayload = {
          locationId: String(data.locationId),
          recipeId: String(data.recipeId),
          productName: String(data.productName),
          plannedQuantity: quantity,
          unit: String(data.unit),
        };
        await this.stageAction(ctx, user, "production.create", payload as unknown as Record<string, unknown>, [
          "<b>Новое производственное задание</b>",
          `Продукт: ${escapeHtml(payload.productName)}`,
          `План: ${formatQuantity(payload.plannedQuantity)} ${escapeHtml(payload.unit)}`,
        ]);
      } else {
        const payload: ProductionBatchPayload = {
          batchId: String(data.batchId),
          productName: String(data.productName),
          actualQuantity: quantity,
        };
        await this.stageAction(ctx, user, "production.complete", payload as unknown as Record<string, unknown>, [
          "<b>Завершение производства</b>",
          `Продукт: ${escapeHtml(payload.productName)}`,
          `Фактически произведено: ${formatQuantity(quantity)}`,
          "",
          "Сырьё по рецепту будет списано со склада автоматически.",
        ]);
      }
      return;
    }

    if (state.step === "sale_item_qty") {
      const quantity = Number(text.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        await this.reply(ctx, "Введите положительное количество, например 3");
        return;
      }
      const items = (data.items as SaleItemDraft[] | undefined) ?? [];
      const pending = data.pendingItem as SaleItemDraft | undefined;
      if (!pending) {
        await this.chatState.clear(chatId);
        await this.reply(ctx, "Не удалось определить товар. Начните продажу заново.");
        return;
      }
      const nextItems = [...items, { ...pending, quantity }];
      await this.chatState.set(chatId, user.id, "sale_cart", {
        locationId: data.locationId,
        customerId: data.customerId ?? null,
        customerName: data.customerName,
        items: nextItems,
      });
      await this.showSaleCart(ctx, nextItems);
      return;
    }

    if (state.step === "payment_amount") {
      const amount = Number(text.replace(",", "."));
      const balanceDue = Number(data.balanceDue);
      if (!Number.isFinite(amount) || amount <= 0) {
        await this.reply(ctx, "Введите положительную сумму, например 5000");
        return;
      }
      if (amount > balanceDue) {
        await this.reply(ctx, `Сумма больше долга (${formatMoney(balanceDue)}). Введите сумму не больше долга.`);
        return;
      }
      await this.chatState.clear(chatId);
      const payload: PaymentActionPayload = {
        saleId: String(data.saleId),
        amount,
        customerName: String(data.customerName),
      };
      const action = await this.pendingActions.create({
        userId: user.id,
        chatId,
        actionType: "sales.recordPayment",
        payload: payload as unknown as Record<string, unknown>,
      });
      await this.reply(
        ctx,
        `<b>Оплата</b>\nКлиент: ${escapeHtml(payload.customerName)}\nСумма: ${formatMoney(payload.amount)}\n\nПодтвердить операцию?`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Подтвердить", `c:${action.id}`), Markup.button.callback("❌ Отмена", `x:${action.id}`)],
        ]),
      );
      return;
    }
  }

  private async skipComment(ctx: any, user: AuthenticatedUser, kind: "receive" | "writeoff") {
    const chatId = String(ctx.chat.id);
    const data = await this.requireStep(ctx, chatId, `${kind}_comment`);
    if (!data) {
      await this.ackCallback(ctx);
      return;
    }
    await this.finishStockWizard(ctx, user, kind, data);
    await this.ackCallback(ctx);
  }

  private async pickWriteOffReason(ctx: any, user: AuthenticatedUser, writeOffReason: WriteOffReason) {
    const chatId = String(ctx.chat.id);
    const data = await this.requireStep(ctx, chatId, "writeoff_reason");
    if (!data) {
      await this.ackCallback(ctx);
      return;
    }
    await this.chatState.set(chatId, user.id, "writeoff_comment", { ...data, writeOffReason });
    await this.reply(
      ctx,
      "Комментарий (необязательно). Отправьте текст или нажмите «Пропустить».",
      Markup.inlineKeyboard([[Markup.button.callback("Пропустить", "s:w:sk")]]),
    );
    await this.ackCallback(ctx);
  }

  private async finishStockWizard(
    ctx: any,
    user: AuthenticatedUser,
    kind: "receive" | "writeoff",
    data: Record<string, unknown>,
  ) {
    const chatId = String(ctx.chat.id);
    const payload: StockActionPayload = {
      locationId: String(data.locationId),
      productId: String(data.productId),
      productName: String(data.productName),
      quantity: Number(data.quantity),
      reason: typeof data.reason === "string" && data.reason.length > 0 ? data.reason : undefined,
      writeOffReason: data.writeOffReason as WriteOffReason | undefined,
    };

    const action = await this.pendingActions.create({
      userId: user.id,
      chatId,
      actionType: kind === "receive" ? "inventory.receive" : "inventory.writeOff",
      payload: payload as unknown as Record<string, unknown>,
    });
    await this.chatState.clear(chatId);

    const verb = kind === "receive" ? "Приход" : "Списание";
    const reasonLine =
      kind === "writeoff" && payload.writeOffReason
        ? `\nПричина: ${WRITE_OFF_REASON_LABELS_RU[payload.writeOffReason]}`
        : "";
    const commentLine = payload.reason ? `\nКомментарий: ${escapeHtml(payload.reason)}` : "";

    await this.reply(
      ctx,
      `<b>${verb}</b>\nТовар: ${escapeHtml(payload.productName)}\nКоличество: ${formatQuantity(payload.quantity)}${reasonLine}${commentLine}\n\nПодтвердить операцию?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Подтвердить", `c:${action.id}`), Markup.button.callback("❌ Отмена", `x:${action.id}`)],
      ]),
    );
  }

  // ---- confirm / cancel -----------------------------------------------------

  // Shared tail of every write wizard: persist what's about to happen as a
  // PENDING action, then show it for confirmation. The action id (not the
  // data) rides in the callback, since Telegram caps callback_data at 64
  // bytes — and claiming that row is what makes a double-tap safe.
  private async stageAction(
    ctx: any,
    user: AuthenticatedUser,
    actionType: string,
    payload: Record<string, unknown>,
    summaryLines: string[],
  ): Promise<void> {
    const chatId = String(ctx.chat.id);
    const action = await this.pendingActions.create({ userId: user.id, chatId, actionType, payload });
    await this.reply(
      ctx,
      `${summaryLines.join("\n")}\n\nПодтвердить операцию?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Подтвердить", `c:${action.id}`),
          Markup.button.callback("❌ Отмена", `x:${action.id}`),
        ],
      ]),
    );
  }

  private async confirmAction(ctx: any, user: AuthenticatedUser, actionId: string) {
    const claim = await this.pendingActions.claim(actionId);
    if (claim.status === "not_found") {
      await this.editOrReply(ctx, "Операция не найдена.");
      await this.ackCallback(ctx);
      return;
    }
    if (claim.status === "expired") {
      await this.editOrReply(ctx, "⏱ Время подтверждения истекло. Начните заново.");
      await this.ackCallback(ctx);
      return;
    }
    if (claim.status === "already") {
      const already =
        claim.action.status === "EXECUTED"
          ? `✅ Уже выполнено (№ ${claim.action.resultId ?? "—"})`
          : claim.action.status === "CANCELLED"
            ? "Операция отменена."
            : "Операция уже обрабатывается.";
      await this.editOrReply(ctx, already);
      await this.ackCallback(ctx);
      return;
    }

    // claim.status === "claimed" — only this request executes the write.
    if (claim.action.userId !== user.id) {
      await this.pendingActions.markFailed(actionId);
      await this.editOrReply(ctx, "⚠️ Операция принадлежит другому пользователю.");
      await this.ackCallback(ctx);
      return;
    }

    // Executing the write and reporting the result to the chat are
    // deliberately separate try/catches: once the underlying service call
    // (and markExecuted) succeeds, that's the real, permanent outcome — a
    // failure only in sending the confirmation message (e.g. the same
    // Telegram hiccup that could hit any reply) must never roll the pending
    // action back to FAILED, or a retry could re-run an already-completed
    // payment/stock movement.
    let resultId: string | null = null;
    let resultMessage: string;
    try {
      if (claim.action.actionType === "inventory.receive" || claim.action.actionType === "inventory.writeOff") {
        if (!INVENTORY_MANAGE_ROLES.includes(user.role)) {
          throw new Error("У вас нет прав на эту операцию.");
        }
        const payload = claim.action.payload as unknown as StockActionPayload;

        if (claim.action.actionType === "inventory.receive") {
          const movement = await this.inventoryService.receive(user, {
            locationId: payload.locationId,
            productId: payload.productId,
            quantity: payload.quantity,
            reason: payload.reason,
          });
          resultId = movement.id;
          resultMessage = `✅ Приход оформлен: ${escapeHtml(payload.productName)} +${formatQuantity(payload.quantity)}`;
        } else {
          const movement = await this.inventoryService.writeOff(user, {
            locationId: payload.locationId,
            productId: payload.productId,
            quantity: payload.quantity,
            writeOffReason: payload.writeOffReason!,
            reason: payload.reason,
          });
          resultId = movement.id;
          resultMessage = `✅ Списание оформлено: ${escapeHtml(payload.productName)} −${formatQuantity(payload.quantity)}`;
        }
      } else if (claim.action.actionType === "sales.recordPayment") {
        if (!PAYMENT_RECORD_ROLES.includes(user.role)) {
          throw new Error("У вас нет прав на эту операцию.");
        }
        const payload = claim.action.payload as unknown as PaymentActionPayload;
        const sale = await this.salesService.recordPayment(user, payload.saleId, { amount: payload.amount });
        resultId = sale.id;
        resultMessage = `✅ Оплата принята: ${escapeHtml(payload.customerName)} — ${formatMoney(payload.amount)}`;
      } else if (claim.action.actionType.startsWith("production.")) {
        if (!PRODUCTION_MANAGE_ROLES.includes(user.role)) {
          throw new Error("У вас нет прав на эту операцию.");
        }
        if (claim.action.actionType === "production.create") {
          const payload = claim.action.payload as unknown as ProductionCreatePayload;
          const batch = await this.productionService.create(user, {
            locationId: payload.locationId,
            recipeId: payload.recipeId,
            plannedQuantity: payload.plannedQuantity,
          });
          resultId = batch.id;
          resultMessage = `✅ Задание создано: ${escapeHtml(payload.productName)} — ${formatQuantity(payload.plannedQuantity)} ${escapeHtml(payload.unit)}`;
        } else if (claim.action.actionType === "production.start") {
          const payload = claim.action.payload as unknown as ProductionBatchPayload;
          const batch = await this.productionService.start(user, payload.batchId);
          resultId = batch.id;
          resultMessage = `▶️ Производство начато: ${escapeHtml(payload.productName)}`;
        } else if (claim.action.actionType === "production.complete") {
          const payload = claim.action.payload as unknown as ProductionBatchPayload;
          const batch = await this.productionService.complete(user, payload.batchId, {
            actualQuantity: payload.actualQuantity!,
          });
          resultId = batch.id;
          resultMessage =
            `✅ Производство завершено: ${escapeHtml(payload.productName)} — ${formatQuantity(payload.actualQuantity ?? 0)}\n` +
            `Сырьё списано со склада, готовая продукция оприходована.`;
        } else {
          throw new Error("Неизвестный тип операции.");
        }
      } else if (claim.action.actionType === "sales.create") {
        if (!SALE_CREATE_ROLES.includes(user.role)) {
          throw new Error("У вас нет прав на эту операцию.");
        }
        const payload = claim.action.payload as unknown as SaleCreatePayload;
        const sale = await this.salesService.create(user, {
          locationId: payload.locationId,
          customerId: payload.customerId ?? undefined,
          paymentMethod: payload.paymentMethod,
          // Retail sales ignore this (always settled in full); for a customer
          // sale it's either the whole amount or nothing, matching the two
          // buttons the wizard offers.
          amountPaid: payload.paidInFull ? payload.totalAmount : 0,
          items: payload.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        });
        resultId = sale.id;
        resultMessage = `✅ Продажа оформлена: ${escapeHtml(payload.customerName)} — ${formatMoney(sale.totalAmount)}`;
      } else {
        throw new Error("Неизвестный тип операции.");
      }
      await this.pendingActions.markExecuted(actionId, resultId);
    } catch (err) {
      await this.pendingActions.markFailed(actionId);
      const message = err instanceof Error ? err.message : "Не удалось выполнить операцию.";
      resultMessage = `⚠️ Ошибка: ${escapeHtml(message)}`;
    }

    try {
      await this.editOrReply(ctx, resultMessage);
    } catch (err) {
      this.logger.error(
        "Failed to send confirmation result (operation outcome above is still final)",
        err instanceof Error ? err.stack : String(err),
      );
    }
    await this.ackCallback(ctx);
  }

  private async cancelAction(ctx: any, user: AuthenticatedUser, actionId: string) {
    const claim = await this.pendingActions.claim(actionId);
    if (claim.status === "claimed") {
      await this.pendingActions.markFailed(actionId);
    }
    await this.editOrReply(ctx, "Отменено.");
    await this.ackCallback(ctx);
  }

  // ---- sales: read ------------------------------------------------------------

  private async showSalesToday(ctx: any, user: AuthenticatedUser, locationId?: string) {
    const summary = await this.salesService.summary(user, locationId);
    const text =
      `📅 <b>Продажи сегодня</b>\n\n` +
      `Выручка сегодня: ${formatMoney(summary.todayRevenue)}\n` +
      `Чеков сегодня: ${summary.todaySalesCount}\n` +
      `Выручка за 7 дней: ${formatMoney(summary.last7DaysRevenue)}\n` +
      `Средний чек: ${formatMoney(summary.averageTicket)}`;
    await this.reply(ctx, text);
    await this.ackCallback(ctx);
  }

  private async showSalesPeriod(ctx: any, user: AuthenticatedUser, days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const report = await this.salesService.report(user, from, to);
    const lines = report.byLocation
      .slice(0, 10)
      .map((l) => `• ${escapeHtml(l.locationName)}: ${formatMoney(l.revenue)} (${l.count} чек.)`);

    const text =
      `🗓 <b>Продажи за ${days} дн.</b>\n\n` +
      `Выручка: ${formatMoney(report.totalRevenue)}\n` +
      `Чеков: ${report.totalCount}` +
      (lines.length > 0 ? `\n\n<b>По точкам:</b>\n${lines.join("\n")}` : "");
    await this.reply(ctx, text);
    await this.ackCallback(ctx);
  }

  private async showSalesLocationPicker(ctx: any, user: AuthenticatedUser) {
    const locations = await this.locationsService.findAllForOrganization(user.organizationId);
    const rows = locations.slice(0, MAX_LIST_ITEMS).map((l) => [Markup.button.callback(l.name, `l:tl:${l.id}`)]);
    rows.push([Markup.button.callback("⬅️ Назад", "l:m")]);
    await this.reply(ctx, "Выберите точку:", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  // ---- customers --------------------------------------------------------------

  // Unlike Склад/Продажи reads (open to any authenticated role on the web
  // too), CustomersController is class-level gated by CUSTOMER_VIEW_ROLES —
  // so every Клиенты handler re-checks it, same as the write-side role
  // checks elsewhere in this file.
  private async assertCustomerAccess(ctx: any, user: AuthenticatedUser): Promise<boolean> {
    if (CUSTOMER_VIEW_ROLES.includes(user.role)) return true;
    await this.reply(ctx, "У вас нет доступа к этому разделу.");
    await this.ackCallback(ctx);
    return false;
  }

  private async showCustomersMenu(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertCustomerAccess(ctx, user))) return;
    await this.replyOrEdit(
      ctx,
      "👥 <b>Клиенты</b>",
      Markup.inlineKeyboard([
        [Markup.button.callback("📋 Список", "cl:l")],
        [Markup.button.callback("⬅️ Назад", "m")],
      ]),
    );
    await this.ackCallback(ctx);
  }

  private async showCustomerList(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertCustomerAccess(ctx, user))) return;
    const customers = await this.customersService.findAllForOrganization(user.organizationId);
    if (customers.length === 0) {
      await this.reply(ctx, "Клиентов пока нет.");
      await this.ackCallback(ctx);
      return;
    }
    const rows = customers.slice(0, MAX_LIST_ITEMS).map((c) => [
      Markup.button.callback(
        c.outstandingBalance > 0 ? `${c.name} (долг ${formatMoney(c.outstandingBalance)})` : c.name,
        `cl:d:${c.id}`,
      ),
    ]);
    rows.push([Markup.button.callback("⬅️ Назад", "cl:m")]);
    await this.reply(ctx, "Выберите клиента:", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  private async showCustomerDetail(ctx: any, user: AuthenticatedUser, customerId: string) {
    if (!(await this.assertCustomerAccess(ctx, user))) return;
    const customer = await this.customersService.findOne(user.organizationId, customerId);

    const lines = [
      `👤 <b>${escapeHtml(customer.name)}</b>`,
      customer.phone ? `Телефон: ${escapeHtml(customer.phone)}` : null,
      `Задолженность: ${formatMoney(customer.outstandingBalance)}`,
    ].filter((line): line is string => line !== null);

    const recentOrders = customer.orders.slice(0, 5);
    if (recentOrders.length > 0) {
      lines.push("", "<b>Последние продажи:</b>");
      for (const o of recentOrders) {
        lines.push(`${formatDate(o.soldAt)} — ${formatMoney(o.totalAmount)} (долг ${formatMoney(o.balanceDue)})`);
      }
    }

    const rows: ReturnType<typeof Markup.inlineKeyboard>["reply_markup"]["inline_keyboard"] = [];
    if (PAYMENT_RECORD_ROLES.includes(user.role) && customer.orders.some((o) => o.balanceDue > 0)) {
      rows.push([Markup.button.callback("💳 Записать оплату", `cl:pm:${customerId}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Назад", "cl:l")]);

    await this.reply(ctx, lines.join("\n"), Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  private async showPaymentSalePicker(ctx: any, user: AuthenticatedUser, customerId: string) {
    if (!PAYMENT_RECORD_ROLES.includes(user.role)) {
      await this.reply(ctx, "У вас нет прав на эту операцию.");
      await this.ackCallback(ctx);
      return;
    }
    const customer = await this.customersService.findOne(user.organizationId, customerId);
    const unpaid = customer.orders.filter((o) => o.balanceDue > 0);
    if (unpaid.length === 0) {
      await this.reply(ctx, "Неоплаченных продаж нет.");
      await this.ackCallback(ctx);
      return;
    }
    const rows = unpaid
      .slice(0, MAX_LIST_ITEMS)
      .map((o) => [Markup.button.callback(`${formatDate(o.soldAt)} — долг ${formatMoney(o.balanceDue)}`, `cl:p:${o.saleId}`)]);
    rows.push([Markup.button.callback("⬅️ Назад", `cl:d:${customerId}`)]);
    await this.reply(ctx, "Выберите продажу для оплаты:", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  // Sets up the wizard's one remaining step (free-text amount) — onText's
  // "payment_amount" branch stages and confirms the actual write, same
  // idempotent pending-action pattern the stock wizards use.
  private async pickSaleForPayment(ctx: any, user: AuthenticatedUser, saleId: string) {
    if (!PAYMENT_RECORD_ROLES.includes(user.role)) {
      await this.reply(ctx, "У вас нет прав на эту операцию.");
      await this.ackCallback(ctx);
      return;
    }
    const sale = await this.salesService.findOne(user, saleId);
    const chatId = String(ctx.chat.id);
    await this.chatState.set(chatId, user.id, "payment_amount", {
      saleId: sale.id,
      customerName: sale.customerName ?? "Розница",
      balanceDue: sale.balanceDue,
    });
    await this.reply(ctx, `Долг по продаже: ${formatMoney(sale.balanceDue)}\nВведите сумму оплаты:`);
    await this.ackCallback(ctx);
  }

  // ---- finance ------------------------------------------------------------------

  private async assertFinanceAccess(ctx: any, user: AuthenticatedUser): Promise<boolean> {
    if (FINANCE_VIEW_ROLES.includes(user.role)) return true;
    await this.reply(ctx, "У вас нет доступа к этому разделу.");
    await this.ackCallback(ctx);
    return false;
  }

  private async showFinanceMenu(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertFinanceAccess(ctx, user))) return;
    await this.replyOrEdit(
      ctx,
      "💵 <b>Финансы</b>",
      Markup.inlineKeyboard([
        [Markup.button.callback("💰 Баланс счетов", "fn:acc")],
        [Markup.button.callback("💵 Cash Flow", "fn:cf")],
        [Markup.button.callback("📄 Расходы", "fn:exp")],
        [Markup.button.callback("📊 P&L", "fn:pnl")],
        [Markup.button.callback("📈 ДЗ/КЗ", "fn:ar")],
        [Markup.button.callback("⚖️ Точка безубыточности", "fn:be")],
        [Markup.button.callback("⬅️ Назад", "m")],
      ]),
    );
    await this.ackCallback(ctx);
  }

  private async showAccounts(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertFinanceAccess(ctx, user))) return;
    const accounts = await this.cashAccountsService.findAll(user.organizationId);
    if (accounts.length === 0) {
      await this.reply(ctx, "Счетов пока нет.");
      await this.ackCallback(ctx);
      return;
    }
    const lines = accounts.map(
      (a) => `${CASH_ACCOUNT_TYPE_LABELS_RU[a.type]} «${escapeHtml(a.name)}»: ${formatMoney(a.currentBalance)}`,
    );
    await this.reply(ctx, `💰 <b>Баланс счетов</b>\n\n${lines.join("\n")}`);
    await this.ackCallback(ctx);
  }

  private async showCashFlow(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertFinanceAccess(ctx, user))) return;
    const movements = await this.cashMovementsService.findAll(user.organizationId, { limit: 15 });
    if (movements.length === 0) {
      await this.reply(ctx, "Движений пока нет.");
      await this.ackCallback(ctx);
      return;
    }
    const lines = movements.map((m) => {
      const isInflow = CASH_MOVEMENT_INFLOW_TYPES.includes(m.type);
      const displayAmount = m.type === CashMovementType.ADJUSTMENT ? m.amount : isInflow ? m.amount : -m.amount;
      const sign = displayAmount >= 0 ? "+" : "";
      return `${formatDateTime(m.occurredAt)} — ${CASH_MOVEMENT_TYPE_LABELS_RU[m.type]} (${escapeHtml(m.accountName)}): ${sign}${formatMoney(displayAmount)}`;
    });
    await this.reply(ctx, `💵 <b>Cash Flow — последние движения</b>\n\n${lines.join("\n")}`);
    await this.ackCallback(ctx);
  }

  private async showExpenses(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertFinanceAccess(ctx, user))) return;
    const expenses = await this.financeService.listExpenses(user.organizationId);
    const shown = expenses.slice(0, 15);
    if (shown.length === 0) {
      await this.reply(ctx, "Расходов пока нет.");
      await this.ackCallback(ctx);
      return;
    }
    const lines = shown.map(
      (e) =>
        `${formatDate(e.incurredOn)} — ${escapeHtml(e.categoryName ?? "Без категории")}: ${formatMoney(e.amount)} (${EXPENSE_STATUS_LABELS_RU[e.status]})`,
    );
    await this.reply(ctx, `📄 <b>Расходы</b>\n\n${lines.join("\n")}`);
    await this.ackCallback(ctx);
  }

  private async showPnl(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertFinanceAccess(ctx, user))) return;
    const now = new Date();
    const from7 = new Date(now);
    from7.setDate(from7.getDate() - 7);
    from7.setHours(0, 0, 0, 0);
    const from30 = new Date(now);
    from30.setDate(from30.getDate() - 30);
    from30.setHours(0, 0, 0, 0);

    const [pnl7, pnl30] = await Promise.all([
      this.financeService.getProfitAndLoss(user.organizationId, from7, now),
      this.financeService.getProfitAndLoss(user.organizationId, from30, now),
    ]);

    const block = (label: string, p: typeof pnl7) =>
      `<b>${label}</b>\nВыручка: ${formatMoney(p.revenue)}\nСебестоимость: ${formatMoney(p.cogs)}\nВаловая прибыль: ${formatMoney(p.grossProfit)}\nРасходы: ${formatMoney(p.expensesTotal)}\nОперационная прибыль: ${formatMoney(p.operatingProfit)}`;

    await this.reply(ctx, `📊 <b>P&L</b>\n\n${block("За 7 дней", pnl7)}\n\n${block("За 30 дней", pnl30)}`);
    await this.ackCallback(ctx);
  }

  private async showAccountsReceivablePayable(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertFinanceAccess(ctx, user))) return;
    const dashboard = await this.financeService.getDashboard(user.organizationId);
    await this.reply(
      ctx,
      `📈 <b>ДЗ/КЗ</b>\n\nДебиторская задолженность: ${formatMoney(dashboard.accountsReceivable)}\nКредиторская задолженность: ${formatMoney(dashboard.accountsPayable)}`,
    );
    await this.ackCallback(ctx);
  }

  // Mirrors the web Finance page's Факт/План split for this metric (see
  // apps/web .../finance/page.tsx's breakEvenMode toggle) — same two
  // figures, same terminology, just both shown at once instead of behind a
  // tab switch. "Точка безубыточности" names the value itself; never
  // paraphrase it (see CLAUDE.md's non-negotiable terminology rule).
  private async showBreakEven(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertFinanceAccess(ctx, user))) return;
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    from.setHours(0, 0, 0, 0);

    const [fact, plan] = await Promise.all([
      this.financeService.getBreakEven(user.organizationId, from, now),
      this.financeService.getPlannedBreakEven(user.organizationId, from, now),
    ]);

    const factBlock =
      fact.status !== BreakEvenStatus.OK
        ? BREAK_EVEN_STATUS_LABELS_RU[fact.status]
        : `Выручка: ${formatMoney(fact.revenue)}\n` +
          `Переменные затраты: ${formatMoney(fact.cogs + fact.variableExpensesTotal)}\n` +
          `Постоянные затраты: ${formatMoney(fact.fixedExpensesTotal)}\n` +
          `Маржинальная прибыль: ${formatMoney(fact.contributionMargin)}\n` +
          `Маржинальность: ${fact.contributionMarginPercent !== null ? fact.contributionMarginPercent.toFixed(1) : "—"}%\n` +
          `<b>Точка безубыточности: ${formatMoney(fact.breakEvenRevenue ?? 0)}</b>`;

    let planBlock: string;
    if (plan.status !== BreakEvenStatus.OK) {
      planBlock = BREAK_EVEN_STATUS_LABELS_RU[plan.status];
    } else {
      planBlock =
        `Плановый ФЗП: ${formatMoney(plan.payroll.total)}/мес.\n` +
        `Прочие постоянные затраты: ${formatMoney(plan.plannedOtherFixedTotal)}/мес.\n` +
        `Постоянные затраты, всего: ${formatMoney(plan.plannedFixedTotal)}/мес.\n` +
        `Маржинальность: ${plan.contributionMarginPercent !== null ? plan.contributionMarginPercent.toFixed(1) : "—"}%\n` +
        `<b>Точка безубыточности: ${formatMoney(plan.breakEvenRevenue ?? 0)}/мес.</b>`;
      if (plan.payroll.exclusions.length > 0) {
        const excludedCount = plan.payroll.exclusions.reduce((sum, ex) => sum + ex.employeeCount, 0);
        planBlock += `\n\n⚠️ Не учтено в плановом ФЗП: ${excludedCount} сотр.`;
      }
    }

    await this.reply(
      ctx,
      `⚖️ <b>Точка безубыточности</b>\n\n` +
        `<b>Факт (30 дней)</b>\n${factBlock}\n\n` +
        `<b>План (месяц)</b>\n${planBlock}`,
    );
    await this.ackCallback(ctx);
  }

  // ---- production ------------------------------------------------------------------

  private async assertProductionAccess(ctx: any, user: AuthenticatedUser): Promise<boolean> {
    if (PRODUCTION_MANAGE_ROLES.includes(user.role)) return true;
    await this.reply(ctx, "У вас нет прав на управление производством.");
    await this.ackCallback(ctx);
    return false;
  }

  private async showProductionMenu(ctx: any, user: AuthenticatedUser) {
    const rows = [
      [Markup.button.callback("📋 Активные задания", "pr:l")],
      [Markup.button.callback("✅ Произведено сегодня", "pr:t")],
    ];
    if (PRODUCTION_MANAGE_ROLES.includes(user.role)) {
      rows.push([Markup.button.callback("➕ Новое задание", "pr:n")]);
    }
    rows.push([Markup.button.callback("⬅️ Назад", "m")]);
    await this.replyOrEdit(ctx, "🏭 <b>Производство</b>", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  // ProductionService.findAll has no status filter (it returns the 100 most
  // recently scheduled batches), so "активные" is filtered here — same as
  // the web Production page's own default "Активные" filter does.
  private async showActiveBatches(ctx: any, user: AuthenticatedUser) {
    const batches = await this.productionService.findAll(user);
    const active = batches.filter(
      (b) => b.status === ProductionBatchStatus.PLANNED || b.status === ProductionBatchStatus.IN_PROGRESS,
    );
    if (active.length === 0) {
      await this.reply(ctx, "Активных заданий нет.");
      await this.ackCallback(ctx);
      return;
    }
    const rows = active
      .slice(0, MAX_LIST_ITEMS)
      .map((b) => [
        Markup.button.callback(
          `${b.status === ProductionBatchStatus.IN_PROGRESS ? "▶️" : "🕒"} ${b.productName} — ${formatQuantity(b.plannedQuantity)} ${b.unit}`,
          `pr:d:${b.id}`,
        ),
      ]);
    rows.push([Markup.button.callback("⬅️ Назад", "pr:m")]);
    await this.reply(ctx, "Выберите задание:", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  private async showTodayProduced(ctx: any, user: AuthenticatedUser) {
    const batches = await this.productionService.findAll(user);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const done = batches.filter(
      (b) =>
        b.status === ProductionBatchStatus.COMPLETED &&
        b.completedAt !== null &&
        new Date(b.completedAt) >= startOfToday,
    );
    if (done.length === 0) {
      await this.reply(ctx, "Сегодня ничего не произведено.");
      await this.ackCallback(ctx);
      return;
    }
    const lines = done.map(
      (b) =>
        `${escapeHtml(b.productName)} — ${formatQuantity(b.actualQuantity ?? 0)} ${escapeHtml(b.unit)} (${escapeHtml(b.locationName)})`,
    );
    await this.reply(ctx, `✅ <b>Произведено сегодня</b>\n\n${lines.join("\n")}`);
    await this.ackCallback(ctx);
  }

  private async showBatchDetail(ctx: any, user: AuthenticatedUser, batchId: string) {
    const batches = await this.productionService.findAll(user);
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) {
      await this.reply(ctx, "Задание не найдено.");
      await this.ackCallback(ctx);
      return;
    }

    const lines = [
      `🏭 <b>${escapeHtml(batch.productName)}</b>`,
      `Точка: ${escapeHtml(batch.locationName)}`,
      `Статус: ${PRODUCTION_BATCH_STATUS_LABELS_RU[batch.status]}`,
      `План: ${formatQuantity(batch.plannedQuantity)} ${escapeHtml(batch.unit)}`,
      `Запланировано на: ${formatDateTime(batch.scheduledFor)}`,
    ];
    if (batch.actualQuantity !== null) {
      lines.push(`Фактически: ${formatQuantity(batch.actualQuantity)} ${escapeHtml(batch.unit)}`);
    }

    const rows: ReturnType<typeof Markup.inlineKeyboard>["reply_markup"]["inline_keyboard"] = [];
    if (PRODUCTION_MANAGE_ROLES.includes(user.role)) {
      if (batch.status === ProductionBatchStatus.PLANNED) {
        rows.push([Markup.button.callback("▶️ Начать", `pr:s:${batch.id}`)]);
      }
      // complete() requires IN_PROGRESS — a PLANNED batch must be started
      // first, so the button only appears once it actually can be used.
      if (batch.status === ProductionBatchStatus.IN_PROGRESS) {
        rows.push([Markup.button.callback("✅ Завершить", `pr:c:${batch.id}`)]);
      }
    }
    rows.push([Markup.button.callback("⬅️ Назад", "pr:l")]);

    await this.reply(ctx, lines.join("\n"), Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  private async startBatchWizard(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertProductionAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    if (ORG_WIDE_ROLES.includes(user.role)) {
      await this.chatState.set(chatId, user.id, "batch_location", {});
      const locations = await this.locationsService.findAllForOrganization(user.organizationId);
      const rows = locations.slice(0, MAX_LIST_ITEMS).map((l) => [Markup.button.callback(l.name, `pr:n:l:${l.id}`)]);
      rows.push([Markup.button.callback("⬅️ Назад", "pr:m")]);
      await this.reply(ctx, "Выберите точку:", Markup.inlineKeyboard(rows));
    } else {
      await this.chatState.set(chatId, user.id, "batch_recipe", { locationId: user.locationId });
      await this.showRecipePicker(ctx, user);
    }
    await this.ackCallback(ctx);
  }

  private async pickBatchLocation(ctx: any, user: AuthenticatedUser, locationId: string) {
    if (!(await this.assertProductionAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    if (!(await this.requireStep(ctx, chatId, "batch_location"))) {
      await this.ackCallback(ctx);
      return;
    }
    await this.chatState.set(chatId, user.id, "batch_recipe", { locationId });
    await this.showRecipePicker(ctx, user);
    await this.ackCallback(ctx);
  }

  private async showRecipePicker(ctx: any, user: AuthenticatedUser) {
    const recipes = await this.recipesService.findAllForOrganization(user.organizationId);
    if (recipes.length === 0) {
      await this.reply(ctx, "Рецептов пока нет — сначала добавьте рецепт в ArAmir OS.");
      return;
    }
    const rows = recipes
      .slice(0, MAX_LIST_ITEMS)
      .map((r) => [Markup.button.callback(`${r.productName} (выход ${formatQuantity(r.yieldQuantity)})`, `pr:n:r:${r.id}`)]);
    rows.push([Markup.button.callback("⬅️ Назад", "pr:m")]);
    await this.reply(ctx, "Что производим?", Markup.inlineKeyboard(rows));
  }

  private async pickBatchRecipe(ctx: any, user: AuthenticatedUser, recipeId: string) {
    if (!(await this.assertProductionAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    const data = await this.requireStep(ctx, chatId, "batch_recipe");
    if (!data) {
      await this.ackCallback(ctx);
      return;
    }
    const recipes = await this.recipesService.findAllForOrganization(user.organizationId);
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) {
      await this.reply(ctx, "Рецепт не найден.");
      await this.ackCallback(ctx);
      return;
    }
    await this.chatState.set(chatId, user.id, "batch_qty", {
      ...data,
      recipeId,
      productName: recipe.productName,
      unit: recipe.productUnit,
    });
    await this.reply(
      ctx,
      `Сколько планируем произвести? Укажите количество в «${escapeHtml(recipe.productUnit)}»:`,
    );
    await this.ackCallback(ctx);
  }

  private async stageBatchStart(ctx: any, user: AuthenticatedUser, batchId: string) {
    if (!(await this.assertProductionAccess(ctx, user))) return;
    const batches = await this.productionService.findAll(user);
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) {
      await this.reply(ctx, "Задание не найдено.");
      await this.ackCallback(ctx);
      return;
    }
    const payload: ProductionBatchPayload = { batchId, productName: batch.productName };
    await this.stageAction(ctx, user, "production.start", payload as unknown as Record<string, unknown>, [
      "<b>Запуск производства</b>",
      `Продукт: ${escapeHtml(batch.productName)}`,
      `План: ${formatQuantity(batch.plannedQuantity)} ${escapeHtml(batch.unit)}`,
    ]);
    await this.ackCallback(ctx);
  }

  private async askBatchActualQuantity(ctx: any, user: AuthenticatedUser, batchId: string) {
    if (!(await this.assertProductionAccess(ctx, user))) return;
    const batches = await this.productionService.findAll(user);
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) {
      await this.reply(ctx, "Задание не найдено.");
      await this.ackCallback(ctx);
      return;
    }
    const chatId = String(ctx.chat.id);
    await this.chatState.set(chatId, user.id, "batch_complete_qty", {
      batchId,
      productName: batch.productName,
    });
    await this.reply(
      ctx,
      `План был ${formatQuantity(batch.plannedQuantity)} ${escapeHtml(batch.unit)}.\nСколько произвели фактически?`,
    );
    await this.ackCallback(ctx);
  }

  // ---- sales: new sale wizard -------------------------------------------------------

  private async assertSaleCreateAccess(ctx: any, user: AuthenticatedUser): Promise<boolean> {
    if (SALE_CREATE_ROLES.includes(user.role)) return true;
    await this.reply(ctx, "У вас нет прав на создание продаж.");
    await this.ackCallback(ctx);
    return false;
  }

  private async startSaleWizard(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertSaleCreateAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    if (ORG_WIDE_ROLES.includes(user.role)) {
      await this.chatState.set(chatId, user.id, "sale_location", {});
      const locations = await this.locationsService.findAllForOrganization(user.organizationId);
      const rows = locations.slice(0, MAX_LIST_ITEMS).map((l) => [Markup.button.callback(l.name, `l:n:l:${l.id}`)]);
      rows.push([Markup.button.callback("⬅️ Назад", "l:m")]);
      await this.reply(ctx, "Выберите точку:", Markup.inlineKeyboard(rows));
    } else {
      await this.chatState.set(chatId, user.id, "sale_customer", { locationId: user.locationId });
      await this.showSaleCustomerPicker(ctx, user);
    }
    await this.ackCallback(ctx);
  }

  private async pickSaleLocation(ctx: any, user: AuthenticatedUser, locationId: string) {
    if (!(await this.assertSaleCreateAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    if (!(await this.requireStep(ctx, chatId, "sale_location"))) {
      await this.ackCallback(ctx);
      return;
    }
    await this.chatState.set(chatId, user.id, "sale_customer", { locationId });
    await this.showSaleCustomerPicker(ctx, user);
    await this.ackCallback(ctx);
  }

  private async showSaleCustomerPicker(ctx: any, user: AuthenticatedUser) {
    // "_" is the sentinel for a walk-in retail sale (no Customer row) — the
    // same "Розница" concept the web sale form uses for a null customerId.
    const rows = [[Markup.button.callback("🧍 Розница (без клиента)", "l:n:c:_")]];
    if (CUSTOMER_VIEW_ROLES.includes(user.role)) {
      const customers = await this.customersService.findAllForOrganization(user.organizationId);
      for (const c of customers.slice(0, MAX_LIST_ITEMS)) {
        rows.push([Markup.button.callback(c.name, `l:n:c:${c.id}`)]);
      }
    }
    rows.push([Markup.button.callback("⬅️ Назад", "l:m")]);
    await this.reply(ctx, "Кому продаём?", Markup.inlineKeyboard(rows));
  }

  private async pickSaleCustomer(ctx: any, user: AuthenticatedUser, customerIdOrRetail: string) {
    if (!(await this.assertSaleCreateAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    const data = await this.requireStep(ctx, chatId, "sale_customer");
    if (!data) {
      await this.ackCallback(ctx);
      return;
    }

    let customerId: string | null = null;
    let customerName = "Розница";
    if (customerIdOrRetail !== "_") {
      const customers = await this.customersService.findAllForOrganization(user.organizationId);
      const customer = customers.find((c) => c.id === customerIdOrRetail);
      if (!customer) {
        await this.reply(ctx, "Клиент не найден.");
        await this.ackCallback(ctx);
        return;
      }
      customerId = customer.id;
      customerName = customer.name;
    }

    await this.chatState.set(chatId, user.id, "sale_cart", {
      locationId: data.locationId,
      customerId,
      customerName,
      items: [],
    });
    await this.showSaleProductPicker(ctx, user);
    await this.ackCallback(ctx);
  }

  private async showSaleProductPicker(ctx: any, user: AuthenticatedUser) {
    // Only finished goods are ever sold — raw materials are consumed through
    // recipes, never sold directly (same filter as the web sale form).
    const products = (await this.productsService.findAllForOrganization(user.organizationId)).filter(
      (p) => p.type === ProductType.FINISHED_GOOD,
    );
    if (products.length === 0) {
      await this.reply(ctx, "Готовой продукции пока нет.");
      await this.ackCallback(ctx);
      return;
    }
    const rows = products
      .slice(0, MAX_LIST_ITEMS)
      .map((p) => [Markup.button.callback(`${p.name} — ${formatMoney(p.price)}`, `l:n:p:${p.id}`)]);
    rows.push([Markup.button.callback("⬅️ Отмена", "l:m")]);
    await this.reply(ctx, "Выберите товар:", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  private async pickSaleProduct(ctx: any, user: AuthenticatedUser, productId: string) {
    if (!(await this.assertSaleCreateAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    const data = await this.requireStep(ctx, chatId, "sale_cart");
    if (!data) {
      await this.ackCallback(ctx);
      return;
    }
    const products = await this.productsService.findAllForOrganization(user.organizationId);
    const product = products.find((p) => p.id === productId);
    if (!product) {
      await this.reply(ctx, "Товар не найден.");
      await this.ackCallback(ctx);
      return;
    }
    // CreateSaleDto requires an explicit unitPrice per item (the backend
    // never falls back to Product.price), so the current catalog price is
    // captured here and shown in the confirmation before anything is written.
    await this.chatState.set(chatId, user.id, "sale_item_qty", {
      ...data,
      pendingItem: {
        productId: product.id,
        productName: product.name,
        quantity: 0,
        unitPrice: product.price,
      } as unknown as Record<string, unknown>,
    });
    await this.reply(
      ctx,
      `«${escapeHtml(product.name)}» — ${formatMoney(product.price)} за ${escapeHtml(product.unit)}.\nСколько продаём?`,
    );
    await this.ackCallback(ctx);
  }

  private async showSaleCart(ctx: any, items: SaleItemDraft[]) {
    const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const lines = items.map(
      (i) => `• ${escapeHtml(i.productName)} — ${formatQuantity(i.quantity)} × ${formatMoney(i.unitPrice)} = ${formatMoney(i.quantity * i.unitPrice)}`,
    );
    await this.reply(
      ctx,
      `🧾 <b>Продажа</b>\n\n${lines.join("\n")}\n\n<b>Итого: ${formatMoney(total)}</b>`,
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ Ещё товар", "l:n:add")],
        [Markup.button.callback("✅ Готово", "l:n:done")],
        [Markup.button.callback("❌ Отмена", "l:m")],
      ]),
    );
  }

  private async showSalePaymentMethodPicker(ctx: any, user: AuthenticatedUser) {
    if (!(await this.assertSaleCreateAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    const state = await this.chatState.get(chatId);
    const data = (state?.data as Record<string, unknown>) ?? {};
    const items = (data.items as SaleItemDraft[] | undefined) ?? [];
    if (items.length === 0) {
      await this.reply(ctx, "Добавьте хотя бы один товар.");
      await this.ackCallback(ctx);
      return;
    }
    const rows = Object.values(PaymentMethod).map((m) => [
      Markup.button.callback(PAYMENT_METHOD_LABELS_RU[m], `l:n:pm:${m}`),
    ]);
    await this.reply(ctx, "Способ оплаты:", Markup.inlineKeyboard(rows));
    await this.ackCallback(ctx);
  }

  private async pickSalePaymentMethod(ctx: any, user: AuthenticatedUser, method: PaymentMethod) {
    if (!(await this.assertSaleCreateAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    const data = await this.requireStep(ctx, chatId, "sale_cart");
    if (!data) {
      await this.ackCallback(ctx);
      return;
    }
    await this.chatState.set(chatId, user.id, "sale_cart", { ...data, paymentMethod: method });

    // A retail sale is always settled in full (SalesService.create enforces
    // it), so only a customer sale is asked about payment — and only as
    // "полностью / в долг": a partial payment is recorded afterwards through
    // Клиенты → Записать оплату rather than complicating this wizard.
    if (!data.customerId) {
      await this.finishSaleWizard(ctx, user, true);
      return;
    }
    await this.reply(
      ctx,
      "Оплата по этой продаже:",
      Markup.inlineKeyboard([
        [Markup.button.callback("💵 Оплачено полностью", "l:n:pd:1")],
        [Markup.button.callback("🧾 В долг", "l:n:pd:0")],
      ]),
    );
    await this.ackCallback(ctx);
  }

  private async finishSaleWizard(ctx: any, user: AuthenticatedUser, paidInFull: boolean) {
    if (!(await this.assertSaleCreateAccess(ctx, user))) return;
    const chatId = String(ctx.chat.id);
    const state = await this.chatState.get(chatId);
    const data = (state?.data as Record<string, unknown>) ?? {};
    const items = (data.items as SaleItemDraft[] | undefined) ?? [];
    if (items.length === 0) {
      await this.reply(ctx, "Добавьте хотя бы один товар.");
      await this.ackCallback(ctx);
      return;
    }

    const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const payload: SaleCreatePayload = {
      locationId: String(data.locationId),
      customerId: (data.customerId as string | null) ?? null,
      customerName: String(data.customerName ?? "Розница"),
      paymentMethod: (data.paymentMethod as PaymentMethod) ?? PaymentMethod.CASH,
      paidInFull,
      items,
      totalAmount,
    };
    await this.chatState.clear(chatId);

    const itemLines = items.map(
      (i) => `• ${escapeHtml(i.productName)} — ${formatQuantity(i.quantity)} × ${formatMoney(i.unitPrice)}`,
    );
    await this.stageAction(ctx, user, "sales.create", payload as unknown as Record<string, unknown>, [
      "<b>Новая продажа</b>",
      `Клиент: ${escapeHtml(payload.customerName)}`,
      `Оплата: ${PAYMENT_METHOD_LABELS_RU[payload.paymentMethod]}${payload.customerId ? (paidInFull ? " (оплачено)" : " (в долг)") : ""}`,
      "",
      ...itemLines,
      "",
      `<b>Итого: ${formatMoney(totalAmount)}</b>`,
    ]);
    await this.ackCallback(ctx);
  }

  // ---- analytics ------------------------------------------------------------------

  private async showAnalyticsMenu(ctx: any, user: AuthenticatedUser) {
    await this.replyOrEdit(
      ctx,
      "📊 <b>Аналитика</b>",
      Markup.inlineKeyboard([
        [Markup.button.callback("📦 Средние продажи (7 дн.)", "an:d:7")],
        [Markup.button.callback("📦 Средние продажи (30 дн.)", "an:d:30")],
        [Markup.button.callback("⚠️ Низкие остатки", "an:lw")],
        [Markup.button.callback("⬅️ Назад", "m")],
      ]),
    );
    await this.ackCallback(ctx);
  }

  // Reuses SalesService.demandAnalysis — the exact same calculation the web
  // Reports page's "Анализ спроса" block shows, no separate logic here.
  private async showDemandAnalysis(ctx: any, user: AuthenticatedUser, days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const analysis = await this.salesService.demandAnalysis(user, from, to, {});
    const { summary } = analysis;

    const lines = [
      `📊 <b>Средние продажи за ${days} дн.</b>`,
      "",
      `Продано: ${formatQuantity(summary.quantity)} шт. в ${summary.salesCount} чек.`,
      `Выручка: ${formatMoney(summary.revenue)}`,
      `В среднем в день: ${summary.avgPerDay !== null ? formatQuantity(summary.avgPerDay) : "—"} шт. / ${summary.avgRevenuePerDay !== null ? formatMoney(summary.avgRevenuePerDay) : "—"}`,
      `Средний чек: ${summary.avgPerSale !== null ? formatQuantity(summary.avgPerSale) : "—"} шт.`,
    ];

    const topProducts = [...analysis.byProduct].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    if (topProducts.length > 0) {
      lines.push("", "<b>Топ товаров по выручке:</b>");
      for (const p of topProducts) {
        lines.push(
          `• ${escapeHtml(p.productName)}: ${formatQuantity(p.quantity)} шт. (${formatMoney(p.revenue)})`,
        );
      }
    }

    await this.reply(ctx, lines.join("\n"));
    await this.ackCallback(ctx);
  }

  // ---- low-level helpers --------------------------------------------------------

  private async reply(ctx: any, text: string, extra?: ReturnType<typeof Markup.inlineKeyboard>) {
    await ctx.reply(text, { parse_mode: "HTML", ...(extra ?? {}) });
  }

  // Menu navigation edits the existing card in place when possible (nicer
  // UX, avoids a growing wall of duplicate menu messages); falls back to a
  // new message when there's nothing to edit (e.g. after /start).
  private async replyOrEdit(ctx: any, text: string, extra: ReturnType<typeof Markup.inlineKeyboard>) {
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...extra });
        return;
      } catch {
        // fall through to a fresh message (e.g. message too old to edit)
      }
    }
    await ctx.reply(text, { parse_mode: "HTML", ...extra });
  }

  private async editOrReply(ctx: any, text: string) {
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML" });
        return;
      } catch {
        // fall through
      }
    }
    await ctx.reply(text, { parse_mode: "HTML" });
  }
}
