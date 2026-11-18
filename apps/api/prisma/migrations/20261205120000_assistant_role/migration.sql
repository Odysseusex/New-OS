-- «Помощник»: the owner's AI assistant as a role of its own, let in by a key only. Additive.
ALTER TYPE "Role" ADD VALUE 'ASSISTANT';

ALTER TABLE "users" ADD COLUMN "assistantKeyId" TEXT;
