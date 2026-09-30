export interface AuditLogEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorName: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}
