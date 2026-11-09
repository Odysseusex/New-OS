-- Customer app sign-in by WhatsApp: off until the owner switches it on (needs the webhook in Meta).
ALTER TABLE "loyalty_settings" ADD COLUMN "clubWhatsappLogin" BOOLEAN NOT NULL DEFAULT false;
