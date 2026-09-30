import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller";

// Writing goes through the plain recordAudit(tx, …) function, not an
// injected service, so any module can audit inside its own transaction
// without a new constructor dependency. This module only exposes reading.
@Module({
  controllers: [AuditController],
})
export class AuditModule {}
