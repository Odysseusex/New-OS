import { Logger, Module } from "@nestjs/common";
import { FISCAL_PROVIDER } from "./fiscal-provider";
import { ReKassaProvider } from "./rekassa.provider";
import { FakeFiscalProvider } from "./fake-fiscal.provider";
import { FiscalService } from "./fiscal.service";

// Which provider is live is decided once, here, from configuration — the rest
// of the app only ever sees FISCAL_PROVIDER. Without re:Kassa credentials the
// fake is used, so the app runs identically on a developer machine and in
// production while fiscalisation is still switched off.
@Module({
  providers: [
    FiscalService,
    ReKassaProvider,
    FakeFiscalProvider,
    {
      provide: FISCAL_PROVIDER,
      inject: [ReKassaProvider, FakeFiscalProvider],
      useFactory: (rekassa: ReKassaProvider, fake: FakeFiscalProvider) => {
        const logger = new Logger("FiscalModule");
        if (rekassa.isConfigured()) {
          logger.log("Fiscal provider: re:Kassa");
          return rekassa;
        }
        logger.warn("Fiscal provider: FAKE (re:Kassa credentials not set) — receipts are not real");
        return fake;
      },
    },
  ],
  exports: [FISCAL_PROVIDER, FiscalService],
})
export class FiscalModule {}
