// The self-service linking flow (Settings -> Telegram) is web-facing and
// goes through the normal request()/JWT path like everything else — these
// two DTOs describe its responses. Everything past linking (menus, wizards,
// notifications) is Telegram-native UI and has no web-facing DTO.

export interface TelegramStatusDto {
  linked: boolean;
}

export interface TelegramLinkTokenDto {
  code: string;
  expiresAt: string;
  botUsername: string | null;
}
