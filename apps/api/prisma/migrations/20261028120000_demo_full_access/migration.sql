-- The sandbox («Песочница») login gets full rights in its own company (it was a
-- «Бухгалтер»). Only logins of DEMO organizations are touched; what reaches
-- beyond one organization refuses a sandbox in code (common/demo-guard.ts).
UPDATE "users" u
SET "role" = 'OWNER', "title" = 'Песочница', "fullName" = 'Демо-доступ'
FROM "organizations" o
WHERE o."id" = u."organizationId"
  AND o."demoParentId" IS NOT NULL
  AND u."email" LIKE 'finance-demo-%'
  AND u."role" = 'ACCOUNTANT';
