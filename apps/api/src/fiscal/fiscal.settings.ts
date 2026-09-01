import { Injectable, Logger } from "@nestjs/common";

// The single switch that decides whether selling goes through the fiscal
// operator at all.
//
// It is OFF unless FISCALIZATION_ENABLED is exactly "true". While it is off,
// SalesService.create() behaves exactly as it always has — same single
// transaction, same order, no fiscal code reached. Turning it on is the whole
// of the deployment step, and turning it back off is the whole of the
// rollback: no migration, no redeploy of a different code path.
//
// It stays off until a real receipt has been punched against a live test
// cash register. A fake provider proving the wiring is not the same as the
// operator accepting our payload.
@Injectable()
export class FiscalSettings {
  private readonly logger = new Logger(FiscalSettings.name);
  private warned = false;

  // Read on every call rather than cached at construction, so tests can flip
  // it and so an operator can change it without a code change.
  isEnabled(): boolean {
    const enabled = process.env.FISCALIZATION_ENABLED === "true";
    if (enabled && !this.warned) {
      this.warned = true;
      this.logger.warn("Fiscalisation is ENABLED — sales will not be recorded without a registered receipt");
    }
    return enabled;
  }
}
