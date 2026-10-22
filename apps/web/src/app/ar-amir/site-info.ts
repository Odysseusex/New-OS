// Everything on the public site that is a FACT about the business lives here,
// so it is filled in one place. An empty value is simply not shown — the page
// never prints a placeholder. The legal lines must match the ИП's documents
// letter for letter: Meta's business verification compares them.

export const SITE_INFO = {
  brand: "Ар Амир",
  tagline: "Дәстүрлі наубайхана",
  // e.g. "ИП Иванов Иван Иванович"
  legalName: "ИП АМИР",
  // ИИН / БИН
  taxId: "061107551240",
  legalAddress: "",
  phone: "",
  email: "amirmakhmudov8200@gmail.com",
  whatsapp: "",
  instagram: "",
  locations: [
    // One building with two street addresses — both lead to the same shop.
    { name: "Пекарня и магазин", address: "г. Актобе, мкр. Алтын Орда, 4д\nпр. Тәуелсіздік, 11", hours: "" },
  ] as { name: string; address: string; hours: string }[],
};

// The bonus programme as the owner set it (Клиенты → Розница). Shown on the
// site as marketing copy; change both together.
export const BONUS = {
  firstPurchasePercent: 5,
  earnPercent: 1,
  maxRedeemPercent: 30,
  lifetimeMonths: 12,
};
