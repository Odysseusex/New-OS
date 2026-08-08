import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { SalesModule } from "../sales/sales.module";
import { QualityModule } from "../quality/quality.module";
import { LocationsModule } from "../locations/locations.module";
import { RecipesModule } from "../recipes/recipes.module";
import { AiAnalyticsService } from "./ai-analytics.service";
import { AiController } from "./ai.controller";

// AI-центр, Этап 1. Imports the modules whose services it reuses rather
// than re-querying their tables directly (see AiAnalyticsService's own
// comments for exactly which method is reused where). No LLM provider, no
// write endpoints — read-only by construction.
@Module({
  imports: [FinanceModule, SalesModule, QualityModule, LocationsModule, RecipesModule],
  providers: [AiAnalyticsService],
  controllers: [AiController],
})
export class AiModule {}
