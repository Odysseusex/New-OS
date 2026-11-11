-- CreateEnum
CREATE TYPE "ClubChatDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ClubChatKind" AS ENUM ('TEXT', 'NOTICE', 'BROADCAST');

-- CreateTable
CREATE TABLE "club_chat_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "direction" "ClubChatDirection" NOT NULL,
    "kind" "ClubChatKind" NOT NULL DEFAULT 'TEXT',
    "title" TEXT,
    "text" TEXT NOT NULL,
    "noticeKey" TEXT,
    "broadcastId" TEXT,
    "sentById" TEXT,
    "sentByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "club_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_chat_broadcasts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "sentById" TEXT,
    "sentByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_chat_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_chat_messages_memberId_createdAt_idx" ON "club_chat_messages"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "club_chat_messages_organizationId_createdAt_idx" ON "club_chat_messages"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "club_chat_messages_organizationId_direction_readAt_idx" ON "club_chat_messages"("organizationId", "direction", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "club_chat_messages_memberId_noticeKey_key" ON "club_chat_messages"("memberId", "noticeKey");

-- CreateIndex
CREATE INDEX "club_chat_broadcasts_organizationId_createdAt_idx" ON "club_chat_broadcasts"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "club_chat_messages" ADD CONSTRAINT "club_chat_messages_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_chat_messages" ADD CONSTRAINT "club_chat_messages_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "club_chat_broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

