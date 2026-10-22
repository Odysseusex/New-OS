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
  phone: "+7 778 637 8485",
  email: "amirmakhmudov8200@gmail.com",
  whatsapp: "",
  instagram: "",
  locations: [
    { name: "Алтын Орда", address: "Микрорайон Алтын Орда, 4д", hours: "" },
    { name: "Тауелсиздик", address: "Проспект Тауелсиздик, 11", hours: "" },
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
