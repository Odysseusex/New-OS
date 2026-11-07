"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Cake,
  CreditCard,
  History,
  MonitorSmartphone,
  MoreHorizontal,
  Percent,
  Printer,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Tag,
  Ticket,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type {
  OpenCrmOrderDto,
  CategoryDto,
  LocationDto,
  ProductDto,
  PromotionCouponPreviewDto,
  TillProductStatsDto,
  SaleDetailDto,
  SaleFiscalReceiptDto,
  LoyaltyMemberDto,
  LoyaltySettingsDto,
} from "@bakery-os/shared";
import {
  FiscalReceiptStatus,
  ORG_WIDE_ROLES,
  PAYMENT_METHOD_LABELS_RU,
  PaymentMethod,
  ProductType,
  MARKDOWN_PERCENT,
  markdownPrice,
  applyDiscountPercent,
  categoryIdsWithDescendants,
  resolveCategoryRule,
  SALE_CREATE_ROLES,
  LOYALTY_TILL_ROLES,
  distributePointsDiscount,
  loyaltyRedeemCap,
  UNIT_LABELS_RU,
  TILL_APPROVER_ROLES,
  TILL_ROLES,
  isPointsRedeemableLine,
  manualDiscountTarget,
} from "@bakery-os/shared";
import { CheckDiscountModal, PinLoginModal, SeniorPinModal, type AppliedDiscount } from "@/components/till-approval";
import { Modal } from "@/components/modal";
import { UiScaleControl } from "@/components/ui-scale-control";
import { TillShiftControl } from "@/components/till-shift-control";
import { NumberPad } from "@/components/number-pad";
import { LabelPrintPicker } from "@/components/label-print-modal";
import { CustomerScreenPickerModal } from "@/components/customer-screen-picker";
import {
  forgetRememberedCustomerScreen,
  openCustomerDisplay,
  useCustomerDisplayPublisher,
  type CustomerState,
  type ScreenPlacement,
} from "@/lib/customer-display";
import { SaleHistoryModal } from "@/components/sale-history-modal";
import { TerminalPaymentPanel } from "@/components/terminal-payment-panel";
import { TerminalConnectionForm } from "@/components/kaspi-terminal-card";
import { isConfigured as isTerminalConfigured, type KaspiTransaction } from "@/lib/kaspi-terminal";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { LoyaltyLookupPanel } from "@/components/loyalty-lookup-panel";
import { PosLoyaltyBlock } from "@/components/pos-loyalty";
import { PosOrderPickerModal } from "@/components/pos-order";
import {
  CategoryCard,
  categoryEmoji,
  CheckLine,
  LineChip,
  PayMethodCards,
  ProductCard,
  TillPopover,
  TillRail,
  TillRailButton,
  ToolButton,
  useLocalPreference,
  type TillPayMode,
} from "@/components/till/till-ui";
import { serverNow } from "@/lib/server-clock";
import { formatDate, formatMoney, formatPoints, formatQuantity } from "@/lib/format";
import { productPhotoUrl } from "@/lib/product-photo";

// A cart line carries its own price rather than reading it off the product,
// because an open-price line's amount is typed by the cashier and two such
// lines in one order are different amounts of the same product row. `key` is
// what identifies a line in the cart — product.id for catalogue items, a
// minted id for open-price ones, so they never merge into each other.
interface CartLine {
  key: string;
  product: ProductDto;
  quantity: number;
  unitPrice: number;
  // Stale goods sold at half price. Off by default and stays off unless the
  // cashier says so: most of what crosses this counter is fresh, and the
  // system cannot tell yesterday's bread from today's — only the person at
  // the shelf can.
  markedDown: boolean;
}

// Payment buttons at the till. Deliberately no "в долг" option: a walk-in
// sale is settled on the spot, and a credit sale belongs to a named customer,
// which is what the Продажи form is for.
// Which payment dialog is open. `null` = none.
type PayMode = "cash" | "card" | "mixed";

// Everything needed to record one sale. Kept as an object rather than four
// positional arguments so that a payment the terminal already took can be
// stored whole and replayed byte-for-byte if recording it fails.
interface PayArgs {
  method: PaymentMethod;
  // The note the buyer handed over — never sent to the server (a walk-in sale
  // is always settled in full), it only works out the change and the slip.
  cashGiven?: number;
  // Sent: it decides which accounts the money lands in.
  split?: { method: PaymentMethod; amount: number }[];
  // Set only when the card half went through the Kaspi terminal. By the time
  // this is used the money has already moved, so a failure to record the sale
  // is a problem to shout about, not to retry silently.
  terminalPayment?: { method: string; transactionId: string; cardMask?: string };
}


export default function PosPage() {
  const { user, logout } = useAuth();
  const canSell = user ? SALE_CREATE_ROLES.includes(user.role) : false;
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;

  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  // Phone only: is the check (under the product grid) on screen? The bar that
  // jumps to it hides while it is.
  const [checkInView, setCheckInView] = useState(false);
  useEffect(() => {
    const el = document.getElementById("pos-check");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCheckInView(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [cart.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // The fiscal receipt for the sale just rung up. Unlike `flash` this does
  // NOT time out: the buyer may want to scan the QR, and a receipt number
  // that vanishes after four seconds is worse than none at all.
  const [receipt, setReceipt] = useState<{ amount: number; fiscal: SaleFiscalReceiptDto } | null>(null);
  // The full sale just rung up, kept regardless of fiscalisation state — a
  // printed slip for the buyer is a separate capability from a fiscal
  // receipt, and useful even with FISCALIZATION_ENABLED off (which is every
  // sale so far). Feeds the print-only block below; the on-screen flash/
  // ReceiptPanel above it stay exactly as they were.
  const [lastSale, setLastSale] = useState<SaleDetailDto | null>(null);
  const [payMode, setPayMode] = useState<PayMode | null>(null);
  // A payment the terminal has ALREADY taken, whose sale did not record. The
  // money has moved, so the only safe retry is one that re-sends this exact
  // transaction — running the card again would charge the buyer twice. Held
  // until the sale lands, and it blocks every payment button meanwhile.
  const [chargedButUnrecorded, setChargedButUnrecorded] = useState<PayArgs | null>(null);
  // Cash handed over and change due for the sale just rung up, kept only long
  // enough to print them on the slip. Deliberately not persisted: the server
  // records what the sale cost, not which note the buyer produced.
  const [cashDetails, setCashDetails] = useState<{ given: number; change: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Labels are printed at the till because that is where the label printer is
  // plugged in — the monoblock is the only machine it is attached to.
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  // Bonus programme on the current order. Settings say whether it is on and
  // how much of a check points may pay; null until loaded (or when the role
  // cannot read them), which simply hides the block.
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettingsDto | null>(null);
  const [loyaltyMember, setLoyaltyMember] = useState<LoyaltyMemberDto | null>(null);
  const [crmOrder, setCrmOrder] = useState<OpenCrmOrderDto | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  // «Скидка на чек» and the senior cashier's approvals (ТЗ §5.4).
  const [checkDiscount, setCheckDiscount] = useState<AppliedDiscount | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [pinLoginOpen, setPinLoginOpen] = useState(false);
  const [pendingLine, setPendingLine] = useState<{ key: string; quantity: number; detail: string } | null>(null);
  const [lineRemovalApproval, setLineRemovalApproval] = useState(false);
  // Set only when openCustomerDisplay() cannot tell which physical monitor is
  // the customer's — no remembered choice yet, or Windows' own displays
  // changed since. See customer-screen-picker.tsx for why this exists at all.
  const [screenPicker, setScreenPicker] = useState<{ screens: ScreenPlacement[]; hostIndex: number | null } | null>(
    null,
  );
  // An older sale the cashier asked for another copy of. Takes precedence
  // over `lastSale` on the printable slip, and clears itself once printed.
  const [reprintSale, setReprintSale] = useState<SaleDetailDto | null>(null);
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false);
  const [terminalPaired, setTerminalPaired] = useState(isTerminalConfigured);
  // A promotion coupon typed in at the till. `appliedCoupon` is only ever a
  // PREVIEW (see api.promotions.lookupCoupon) — it never claims the coupon.
  // The actual claim happens server-side, atomically with the sale, when
  // `couponCode` is submitted with it.
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<PromotionCouponPreviewDto | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [payMethod, setPayMethod] = useState<TillPayMode>("cash");
  const [moreOpen, setMoreOpen] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);

  // The scan box must own the keyboard: a USB scanner is just a keyboard that
  // types very fast and presses Enter, so whatever is focused receives the
  // barcode. Pulling focus back after every tap keeps a scan working even
  // once the cashier has been clicking tiles.
  //
  // `preventScroll` is the whole point of this being a helper. The scan box
  // sits at the top of the page, so focusing it scrolls it into view — which
  // meant that tapping a product far down the grid threw the cashier back to
  // the top, and tapping the same tile twice to ring up two of something was
  // impossible: the tile was no longer under their finger.
  const focusScan = useCallback(() => scanRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {});
    api.loyalty.settings().then(setLoyaltySettings).catch(() => setLoyaltySettings(null));
    api.locations.list().then(setLocations).catch(() => {});
  }, []);

  // Reloaded whenever the point of sale changes, because the price depends on
  // it: the retail point charges its own prices, everywhere else charges the
  // organization's default. Waits for a location rather than loading the
  // defaults first, so the grid never briefly shows the wrong prices.
  useEffect(() => {
    if (!locationId) return;
    // A sale moves finished goods; raw materials are never rung up at a till.
    // The open-price row is filtered out too — it gets its own button rather
    // than sitting in the grid as a meaningless 0 ₸ tile.
    api.products
      .list(false, locationId)
      .then((all) =>
        setProducts(all.filter((p) => p.isActive && p.type === ProductType.FINISHED_GOOD && !p.isOpenPrice)),
      )
      .catch(() => setError("Не удалось загрузить товары"));
    // A part-built order belongs to the point it was priced at. Carrying it
    // across would keep the old prices while the grid shows new ones.
    setCart([]);
    setLoyaltyMember(null);
    setCrmOrder(null);
    setPointsToRedeem(0);
    // A coupon is validated against one specific location (see
    // Promotion.locationId) — switching points invalidates whatever was
    // typed in, same reasoning as clearing the cart above.
    setAppliedCoupon(null);
    setCouponCode("");
    setCouponError(null);
  }, [locationId]);

  // A location-scoped cashier sells at their own point and nowhere else.
  // They deliberately do NOT fall back to locations[0] when unassigned: that
  // silently sold at whichever point sorted first alphabetically, using ITS
  // prices, with no picker on their screen to reveal or correct it. Refusing
  // to guess turns an invisible wrong price into an obvious blocked till.
  useEffect(() => {
    if (locationId) return;
    if (!isOrgWide) {
      if (user?.locationId) setLocationId(user.locationId);
      return;
    }
    if (locations.length > 0) setLocationId(locations[0].id);
  }, [locations, locationId, isOrgWide, user]);

  const activeLocationName = locations.find((l) => l.id === locationId)?.name ?? null;
  const missingLocation = !isOrgWide && !user?.locationId;

  useEffect(focusScan, [focusScan]);

  // Typing anywhere on the page (including a scan arriving while focus sits on
  // a tile) is redirected into the scan box, so nothing is ever swallowed.
  useEffect(() => {
    // While an amount dialog is open the keypad owns the keyboard — pulling
    // focus back to the scan box would send the cashier's digits into the
    // product search instead of into the amount.
    // History is included for a different reason than the amount dialogs: a
    // scanner firing while the cashier is looking at past receipts would
    // otherwise type into the search box behind the dialog and quietly drop
    // a product into the cart nobody asked for. The customer-by-phone dialog
    // is excluded for the same reason.
    if (historyOpen || loyaltyOpen || payMode !== null || couponOpen || orderPickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) focusScan();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusScan, historyOpen, loyaltyOpen, payMode, couponOpen, orderPickerOpen]);

  // Only categories that actually hold something sellable. Without this the
  // till offers chips like «Сырьё», which can only ever show an empty grid,
  // since raw materials are never rung up here.
  // The till shows MAIN categories only — subcategories are an admin/analytics
  // dimension and never become till tabs. A main category counts as used when it,
  // or any subcategory under it, holds something sellable.
  const sellableCategories = useMemo(() => {
    const usedIds = new Set(products.map((p) => p.categoryId).filter(Boolean));
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
    const topUsed = new Set<string>();
    usedIds.forEach((id) => {
      const parentId = parentOf.get(id as string);
      topUsed.add((parentId ?? id) as string);
    });
    return categories.filter((c) => c.isActive && !c.parentId && topUsed.has(c.id));
  }, [categories, products]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = useMemo(() => {
    let list = products;
    // A chosen main category covers everything in its subcategories too.
    if (categoryId) {
      const ids = new Set(categoryIdsWithDescendants(categories, categoryId));
      list = list.filter((p) => p.categoryId !== null && ids.has(p.categoryId));
    }
    if (normalizedQuery) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(normalizedQuery) ||
          (p.sku ?? "").toLowerCase().includes(normalizedQuery) ||
          (p.barcode ?? "").toLowerCase().includes(normalizedQuery),
      );
    }
    return list;
  }, [products, categories, categoryId, normalizedQuery]);

  // Pinned ahead of the category grid, unaffected by the category filter or
  // search — the whole point is a cashier reaching it in one tap regardless
  // of what's currently selected. Still present in visibleProducts too (not
  // exclusive), so browsing/search still finds it normally.
  const quickItems = useMemo(() => products.filter((p) => p.isPosQuickItem), [products]);

  // Category -> percent from the applied coupon's rules, or null when none is
  // applied. A pure lookup table — deciding whether it actually applies to a
  // given line is couponPercentFor() below, since an open-price or
  // already-marked-down line is never eligible.
  const couponRuleByCategory = useMemo(() => {
    if (!appliedCoupon) return null;
    return new Map(appliedCoupon.rules.map((r) => [r.categoryId, r.discountPercent]));
  }, [appliedCoupon]);

  // The coupon's discount is applied by category automatically — a cashier
  // never picks a percent by hand, which is what removes the till-mistake
  // this is guarding against. A line already marked down by hand keeps that
  // discount instead: the two never stack, same rule the server enforces.
  function couponPercentFor(line: CartLine): number | null {
    if (!couponRuleByCategory || line.markedDown || line.product.isOpenPrice || !line.product.categoryId) {
      return null;
    }
    // A rule on a category also covers its subcategories; one on the
    // subcategory itself wins — the same lookup the server makes.
    return (
      resolveCategoryRule(couponRuleByCategory, line.product.categoryId, (id) => categories.find((c) => c.id === id)?.parentId) ?? null
    );
  }

  // This is a LIVE PREVIEW only, computed with the same shared formula the
  // server uses — the server is what actually decides and claims the
  // discount when the sale is submitted (see handlePay). Kept in sync so the
  // cashier and the customer screen never show a number the receipt then
  // contradicts.
  function displayUnitPrice(line: CartLine): number {
    const percent = couponPercentFor(line);
    return percent !== null ? applyDiscountPercent(line.unitPrice, percent) : line.unitPrice;
  }

  // The price before the markdown or coupon on a line, null at full price —
  // the same marker the server puts on the line.
  function fullPriceOf(line: CartLine): number | null {
    return line.markedDown ? line.product.effectivePrice : couponPercentFor(line) !== null ? line.unitPrice : null;
  }

  const cartTotal = cart.reduce((sum, line) => sum + displayUnitPrice(line) * line.quantity, 0);

  // Points pay part of the check as a discount on the lines at full price.
  // Same shared functions as the server, so the total charged (and sent to the
  // Kaspi terminal) is exactly the one the sale records.
  const loyaltyLines = cart.map((line) => ({
    quantity: line.quantity,
    unitPrice: displayUnitPrice(line),
    fullUnitPrice: fullPriceOf(line),
    consignment: !!line.product.consignmentSupplierId,
  }));
  const loyaltyActive = !!loyaltySettings?.enabled && !!loyaltyMember;
  const pointsCap =
    loyaltyActive && loyaltySettings && loyaltyMember
      ? loyaltyRedeemCap(loyaltyLines, loyaltySettings.maxRedeemPercent, loyaltyMember.pointsBalance)
      : 0;
  const pointsRequested = Math.min(pointsToRedeem, pointsCap);
  const pointsDiscount = loyaltyActive && pointsRequested > 0 ? distributePointsDiscount(loyaltyLines, pointsRequested) : null;
  const pointsDiscountByIndex = new Map((pointsDiscount?.lines ?? []).map((l) => [l.index, l]));
  // The check discount: same shared spreading as the server, never with a coupon or points.
  const discountBase =
    Math.round(loyaltyLines.filter(isPointsRedeemableLine).reduce((sum, l) => sum + l.unitPrice * l.quantity, 0) * 100) / 100;
  const checkDiscountSpread =
    checkDiscount && !pointsDiscount && !appliedCoupon ? distributePointsDiscount(loyaltyLines, manualDiscountTarget(discountBase, checkDiscount)) : null;
  const total = Math.round((cartTotal - (pointsDiscount?.total ?? 0) - (checkDiscountSpread?.total ?? 0)) * 100) / 100;
  const isApprover = !!user && TILL_APPROVER_ROLES.includes(user.role);

  // Lowering a quantity or removing a line: with the switch on, a cashier needs the senior cashier's PIN.
  function changeLine(key: string, quantity: number) {
    const line = cart.find((l) => l.key === key);
    if (line && quantity < line.quantity && lineRemovalApproval && !isApprover) {
      const removed = quantity <= 0 ? line.quantity : line.quantity - quantity;
      setPendingLine({ key, quantity, detail: `${line.product.name} × ${formatQuantity(removed)}` });
      return;
    }
    setLineQuantity(key, quantity);
  }
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  async function applyCoupon() {
    const code = couponCode.trim();
    if (!code || !locationId) return;
    setCouponLoading(true);
    setCouponError(null);
    try {
      const preview = await api.promotions.lookupCoupon(code, locationId);
      setAppliedCoupon(preview);
    } catch (err) {
      setAppliedCoupon(null);
      setCouponError(err instanceof ApiError ? err.message : "Не удалось проверить купон");
    } finally {
      setCouponLoading(false);
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponCode("");
    setCouponError(null);
  }

  // What the buyer's screen shows. Derived from the cart rather than pushed
  // at it from each handler, so there is no path that changes the cart and
  // forgets to update the display — every one of them already goes through
  // setCart, and this recomputes from the result.
  //
  // The paid state wins while it is showing: `lastSale` is cleared when the
  // next order starts, and until then the buyer is still looking at what they
  // owe and their change. Deliberately no cost, margin or markdown flag beyond
  // the struck-through price — this screen faces the shop floor.
  const customerState = useMemo<CustomerState>(() => {
    if (cart.length === 0 && lastSale) {
      return {
        kind: "paid",
        locationName: activeLocationName,
        total: lastSale.totalAmount,
        change: cashDetails ? cashDetails.change : null,
        receiptNumber: lastSale.fiscalReceipt?.ticketNumber ?? null,
        qrCode: lastSale.fiscalReceipt?.qrCode ?? null,
      };
    }
    if (cart.length === 0) return { kind: "idle", locationName: activeLocationName };
    return {
      kind: "cart",
      locationName: activeLocationName,
      total,
      lines: cart.map((line, index) => {
        const byPoints = pointsDiscountByIndex.get(index);
        return {
          key: line.key,
          name: line.product.name,
          quantity: line.quantity,
          unit: UNIT_LABELS_RU[line.product.unit],
          unitPrice: byPoints ? byPoints.unitPrice : displayUnitPrice(line),
          fullUnitPrice: byPoints ? byPoints.fullUnitPrice : fullPriceOf(line),
        };
      }),
    };
    // couponPercentFor/displayUnitPrice are plain functions closing over
    // couponRuleByCategory, which IS listed — they need no dep of their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, total, lastSale, cashDetails, activeLocationName, couponRuleByCategory, pointsDiscount?.total]);

  useCustomerDisplayPublisher(customerState);

  function addToCart(product: ProductDto, step = 1) {
    setCart((current) => {
      const existing = current.find((line) => line.key === product.id);
      if (!existing) {
        // effectivePrice, not price: what this point of sale charges, which
        // for the retail point is not the organization's default.
        return [
          ...current,
          { key: product.id, product, quantity: step, unitPrice: product.effectivePrice, markedDown: false },
        ];
      }
      return current.map((line) =>
        line.key === product.id ? { ...line, quantity: line.quantity + step } : line,
      );
    });
    setError(null);
    // The previous buyer's confirmation must not still be on screen while the
    // next order is being rung up. Starting the next order is the main way
    // it gets cleared — «Без чека» is for when the cashier wants the screen
    // clean before that.
    setReceipt(null);
    setFlash(null);
  }

  function toggleMarkdown(key: string) {
    setCart((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const markedDown = !line.markedDown;
        return {
          ...line,
          markedDown,
          // Recomputed from the product's price at this point rather than
          // discounted and scaled back, so switching the markdown off restores
          // the exact original price instead of a rounding artefact.
          unitPrice: markedDown ? markdownPrice(line.product.effectivePrice) : line.product.effectivePrice,
        };
      }),
    );
  }

  function setLineQuantity(key: string, quantity: number) {
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.key !== key)
        : current.map((line) => (line.key === key ? { ...line, quantity } : line)),
    );
  }

  // Enter is what a scanner presses after the digits. An exact barcode match
  // wins over a name match: a scanned code must never be ambiguous just
  // because some product name happens to contain the same digits.
  function handleScanSubmit() {
    const raw = query.trim();
    if (!raw) return;
    const lower = raw.toLowerCase();

    // Barcode first, then SKU. Own production — bread, cakes — carries no
    // manufacturer's barcode, so the label printed for it encodes the SKU
    // instead; matching both is what makes that label ring the product up
    // rather than land as an unrecognised code.
    const byCode = products.filter(
      (p) => (p.barcode ?? "").toLowerCase() === lower || p.sku.toLowerCase() === lower,
    );
    if (byCode.length === 1) {
      addToCart(byCode[0]);
      setQuery("");
      return;
    }
    if (byCode.length > 1) {
      setError(`Штрихкод ${raw} привязан к нескольким товарам — исправьте в номенклатуре`);
      setQuery("");
      return;
    }

    if (visibleProducts.length === 1) {
      addToCart(visibleProducts[0]);
      setQuery("");
      return;
    }
    if (visibleProducts.length === 0) {
      setError(`Товар «${raw}» не найден`);
      // The box must end up empty even when the scan failed: a scanner types
      // straight into it, so a leftover code would prepend itself to the next
      // scan ("0000…" + "4870…") and ring up the wrong product entirely.
      setQuery("");
    }
  }

  // `cashGiven` is the note the buyer handed over — it is never sent to the
  // server (a walk-in sale is always settled in full, so `amountPaid` is the
  // total either way); it exists only to work out the change and to put both
  // numbers on the printed slip. `split` IS sent: it decides which accounts
  // the money lands in.
  async function handlePay({ method, cashGiven, split, terminalPayment }: PayArgs) {
    if (cart.length === 0 || !locationId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const sale = await api.sales.create({
        locationId,
        paymentMethod: method,
        ...(split ? { payments: split } : {}),
        ...(terminalPayment ? { terminalPayment } : {}),
        // The server decides which lines this actually discounts and claims
        // the coupon itself — the cart's per-line unitPrice below is sent
        // unchanged even for lines the coupon preview shows discounted.
        ...(appliedCoupon ? { couponCode: couponCode.trim() } : {}),
        // The same amount the cart discounted by; the server distributes it
        // with the same function and re-checks the balance and the limit.
        ...(loyaltyActive && loyaltyMember
          ? { loyaltyMemberId: loyaltyMember.id, ...(pointsRequested > 0 ? { loyaltyPointsToRedeem: pointsRequested } : {}) }
          : {}),
        ...(crmOrder ? { crmOrderId: crmOrder.id } : {}),
        ...(checkDiscountSpread && checkDiscount
          ? {
              manualDiscount: checkDiscount.percent !== undefined ? { percent: checkDiscount.percent } : { amount: checkDiscount.amount },
              ...(checkDiscount.approvalToken ? { approvalToken: checkDiscount.approvalToken } : {}),
            }
          : {}),
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          ...(line.markedDown ? { fullUnitPrice: line.product.effectivePrice } : {}),
        })),
      });
      // With fiscalisation off there is no receipt, and the short green
      // flash is the whole confirmation — exactly as before.
      if (sale.fiscalReceipt) {
        setReceipt({ amount: total, fiscal: sale.fiscalReceipt });
      } else {
        const change = cashGiven !== undefined ? cashGiven - total : 0;
        const points = sale.loyalty
          ? `. Баллы: −${formatPoints(sale.loyalty.pointsRedeemed)}, +${formatPoints(sale.loyalty.pointsEarned)}`
          : "";
        setFlash(
          change > 0
            ? `Продажа проведена — ${formatMoney(total)}. Сдача ${formatMoney(change)}${points}`
            : `Продажа проведена — ${formatMoney(total)}${points}`,
        );
      }
      setLastSale(sale);
      setCashDetails(cashGiven !== undefined ? { given: cashGiven, change: cashGiven - total } : null);
      setCart([]);
      setQuery("");
      removeCoupon();
      setLoyaltyMember(null);
      setCrmOrder(null);
      setPointsToRedeem(0);
      setCheckDiscount(null);
      setChargedButUnrecorded(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести продажу");
      // The card was already charged, so this cannot be retried by simply
      // pressing «Картой» again — that would run a second payment. The exact
      // arguments are kept for a retry that re-sends the same transaction.
      if (terminalPayment) {
        setChargedButUnrecorded({ method, cashGiven, split, terminalPayment });
      }
    } finally {
      setIsSubmitting(false);
      focusScan();
    }
  }

  // Reprinting an older receipt is deferred by a beat so the history dialog
  // is really gone from the document first — window.print() captures the DOM
  // as it stands, and printing over an open dialog would put the dialog on
  // the slip. The flag is cleared inside the timeout, not in the effect body:
  // clearing it here would re-run the effect and its own cleanup would cancel
  // the print before it fired.
  useEffect(() => {
    if (!reprintSale) return;
    const timer = setTimeout(() => {
      window.print();
      setReprintSale(null);
    }, 50);
    return () => clearTimeout(timer);
  }, [reprintSale]);

  // The till's cards: sold today / in 30 days and, for managers, what is on the shelf.
  const [tillStats, setTillStats] = useState<TillProductStatsDto[]>([]);
  useEffect(() => {
    if (!locationId) return;
    api.sales
      .tillStats(locationId)
      .then(setTillStats)
      .catch(() => setTillStats([]));
  }, [locationId, lastSale]);
  const statsByProduct = useMemo(() => new Map(tillStats.map((s) => [s.productId, s])), [tillStats]);
  // The till's own staff count the shelf blind in «Сверка дня», so the book stock is not shown to them.
  const isCashier = !!user && TILL_ROLES.includes(user.role);
  const isBlindTill = isCashier;
  const [sortMode, setSortMode] = useLocalPreference<"popular" | "name">("till.sort", "popular");
  const sortedProducts = useMemo(() => {
    const list = visibleProducts.filter((p) => !p.isPosQuickItem);
    if (sortMode === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return [...list].sort(
      (a, b) =>
        (statsByProduct.get(b.id)?.sold30Days ?? 0) - (statsByProduct.get(a.id)?.sold30Days ?? 0) || a.name.localeCompare(b.name, "ru"),
    );
  }, [visibleProducts, sortMode, statsByProduct]);
  // Pictures only once the shop has any: until then the cards stay compact.
  const anyPhoto = useMemo(() => products.some((p) => p.photoVersion), [products]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of sellableCategories) {
      const ids = new Set(categoryIdsWithDescendants(categories, c.id));
      counts.set(c.id, products.filter((p) => p.categoryId !== null && ids.has(p.categoryId)).length);
    }
    return counts;
  }, [sellableCategories, categories, products]);
  const topCategoryName = useCallback(
    (categoryId: string | null) => {
      if (!categoryId) return null;
      const cat = categories.find((c) => c.id === categoryId);
      if (!cat) return null;
      return cat.parentId ? (categories.find((c) => c.id === cat.parentId)?.name ?? cat.name) : cat.name;
    },
    [categories],
  );
  const categoryNameOf = (p: ProductDto) => topCategoryName(p.categoryId) ?? p.categoryName;
  const inCartLabel = (p: ProductDto) => {
    const q = cart.filter((l) => l.product.id === p.id).reduce((sum, l) => sum + l.quantity, 0);
    return q > 0 ? `${formatQuantity(q)}${p.unit === "PCS" ? "" : ` ${UNIT_LABELS_RU[p.unit]}`} в чеке` : null;
  };
  // «Продано сегодня 12 · Осталось 30»: only what is worth reading; the stock never for the till's staff.
  const cardMeta = (p: ProductDto, stats: TillProductStatsDto | undefined) => {
    const sold = stats?.soldToday ?? 0;
    const stock = !isBlindTill && p.trackInventory ? (stats?.stock ?? null) : null;
    if (sold <= 0 && stock === null) return null;
    return (
      <span>
        {sold > 0 && `Сегодня ${formatQuantity(sold)}`}
        {sold > 0 && stock !== null && " · "}
        {stock !== null && <span className={stock <= 0 ? "text-red-600" : undefined}>Остаток {formatQuantity(stock)}</span>}
      </span>
    );
  };
  const couponPercentForProduct = (p: ProductDto): number | null => {
    if (!couponRuleByCategory || !p.categoryId) return null;
    return resolveCategoryRule(couponRuleByCategory, p.categoryId, (id) => categories.find((c) => c.id === id)?.parentId) ?? null;
  };
  const todayLabel = useMemo(() => {
    const s = serverNow().toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSale]);
  // Сумма → what came off it, so «Итого» reads as a sum the cashier can follow.
  const markdownTotal = cart.reduce((sum, l) => sum + (l.markedDown ? (l.product.effectivePrice - l.unitPrice) * l.quantity : 0), 0);
  const couponTotal = cart.reduce((sum, l) => sum + (l.unitPrice - displayUnitPrice(l)) * l.quantity, 0);
  const grossTotal = cartTotal + markdownTotal + couponTotal;
  const summaryRows: { label: string; value: string; negative?: boolean }[] = [];
  if (markdownTotal > 0 || couponTotal > 0 || pointsDiscount || checkDiscountSpread) {
    summaryRows.push({ label: `Сумма · ${formatQuantity(itemCount)} шт`, value: formatMoney(grossTotal) });
    if (markdownTotal > 0) summaryRows.push({ label: "Уценка", value: `− ${formatMoney(markdownTotal)}`, negative: true });
    if (couponTotal > 0) summaryRows.push({ label: "Купон", value: `− ${formatMoney(couponTotal)}`, negative: true });
    if (pointsDiscount && pointsDiscount.total > 0) summaryRows.push({ label: "Баллами", value: `− ${formatMoney(pointsDiscount.total)}`, negative: true });
    if (checkDiscountSpread && checkDiscountSpread.total > 0) summaryRows.push({ label: "Скидка на чек", value: `− ${formatMoney(checkDiscountSpread.total)}`, negative: true });
  }

  if (user && !canSell) {
    return <p className="mx-auto max-w-6xl text-sm text-muted">У вас нет прав на оформление продаж.</p>;
  }

  return (
    <div className="till-theme min-h-full lg:h-full">
    <div className="flex min-h-full flex-col print:hidden lg:h-full lg:flex-row">
      <TillRail onLogout={logout} homeHref={isCashier ? null : "/dashboard"}
        footer={
          <TillRailButton icon={MoreHorizontal} label="Ещё" active={moreOpen} onClick={() => setMoreOpen((v) => !v)} />
        }
      >
        {/* The till is the only screen a cashier can reach, so checking what was already sold,
            printing a sticker and pairing the terminal all live here. */}
        <TillRailButton icon={History} label="История" onClick={() => setHistoryOpen(true)} />
        {user && LOYALTY_TILL_ROLES.includes(user.role) && (
          <TillRailButton icon={UserRound} label="Клиенты" onClick={() => setLoyaltyOpen(true)} />
        )}
        <TillRailButton icon={Tag} label="Этикетки" onClick={() => setLabelsOpen(true)} />
        {/* The buyer's screen on the monoblock's second display: once per boot, then it follows the
            cart. Which monitor is picked once and remembered (customer-display.ts). */}
        <TillRailButton
          icon={MonitorSmartphone}
          label="Экран покупателя"
          onClick={async () => {
            const result = await openCustomerDisplay();
            if (result.kind === "blocked") {
              setError("Браузер заблокировал новое окно. Разрешите всплывающие окна для этого сайта.");
            } else if (result.kind === "needs-pick") {
              setScreenPicker({ screens: result.screens, hostIndex: result.hostIndex });
            } else if (result.kind !== "placed") {
              setFlash("Экран покупателя открыт. Перетащите окно на второй экран пальцем за верхний край.");
            }
          }}
        />
        {/* Pairing the terminal has to happen on this machine, next to the terminal — so a cashier
            whose terminal dropped overnight can fix it without the owner. */}
        <TillRailButton icon={CreditCard} label="Терминал" dot={terminalPaired ? "ok" : "bad"} onClick={() => setTerminalSettingsOpen(true)} />
      </TillRail>
      <TillPopover open={moreOpen} onClose={() => setMoreOpen(false)}>
        <p className="mb-2 text-sm font-semibold text-foreground">Масштаб экрана</p>
        <UiScaleControl />
        {/* For when Windows decided another monitor is «главный»: forget the remembered screen
            and ask again. */}
        <button
          onClick={async () => {
            setMoreOpen(false);
            forgetRememberedCustomerScreen();
            const result = await openCustomerDisplay();
            if (result.kind === "needs-pick") {
              setScreenPicker({ screens: result.screens, hostIndex: result.hostIndex });
            } else if (result.kind === "blocked") {
              setError("Браузер заблокировал новое окно. Разрешите всплывающие окна для этого сайта.");
            }
          }}
          className="mt-4 flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
          Сменить экран покупателя
        </button>
      </TillPopover>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:h-[5.5rem] lg:flex-nowrap lg:px-8 lg:py-0">
          <div className="relative min-w-[13rem] flex-1 lg:max-w-[34rem]">
            <input
              ref={scanRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScanSubmit();
                }
              }}
              placeholder="Поиск товара или сканер"
              className="h-[3.25rem] w-full rounded-2xl border border-border bg-surface pl-5 pr-12 text-base text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)] outline-none placeholder:text-muted focus:border-accent"
            />
            {query ? (
              <button onClick={() => setQuery("")} aria-label="Очистить поиск" className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            ) : (
              <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground" strokeWidth={1.75} />
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {locationId && (
              <TillShiftControl pill locationId={locationId} reloadKey={lastSale} onState={(st) => setLineRemovalApproval(st.lineRemovalApproval)} />
            )}
            {/* The point is shown to everyone: prices differ per point, and a cashier who cannot
                see it cannot tell the prices are another shop's. */}
            {isOrgWide && (
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="h-10 rounded-full border border-border bg-surface px-3 text-sm font-medium text-foreground outline-none focus:border-accent"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            )}
            <div className="hidden max-w-[13rem] text-right leading-tight sm:block">
              <p className="truncate whitespace-nowrap text-base font-semibold text-foreground">{user?.fullName.split(" ")[0] ?? "Кассир"}</p>
              <p className="mt-0.5 hidden truncate whitespace-nowrap text-[0.8125rem] text-muted xl:block">
                {todayLabel}
                {!isOrgWide && activeLocationName ? ` · ${activeLocationName}` : ""}
              </p>
            </div>
            <button
              onClick={() => setPinLoginOpen(true)}
              title="Сменить кассира"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-lg font-semibold text-accent transition hover:ring-2 hover:ring-[var(--accent-line)]"
            >
              {(user?.fullName ?? "К").charAt(0).toUpperCase()}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-5 lg:px-8 lg:pb-8 lg:pt-6">
          {missingLocation && (
            <div className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Вам не назначена точка продаж, поэтому касса не знает, по каким ценам продавать. Обратитесь к
              владельцу — точка указывается в Настройках, в карточке сотрудника.
            </div>
          )}
          {/* No timeout: the cashier asks the buyer whether they want a slip, and that conversation
              outlasts any timer. Cleared by the next order or «Без чека». */}
          {flash && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-5 py-4 text-base font-semibold text-emerald-900 ring-1 ring-emerald-200">
              <span>{flash}</span>
              {lastSale && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => window.print()}
                    className="flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 transition hover:bg-emerald-50"
                  >
                    <Printer className="h-4 w-4" strokeWidth={1.75} />
                    Печать
                  </button>
                  <button
                    onClick={() => {
                      setFlash(null);
                      focusScan();
                    }}
                    className="h-10 rounded-xl px-4 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
                  >
                    Без чека
                  </button>
                </div>
              )}
            </div>
          )}
          {receipt && (
            <ReceiptPanel amount={receipt.amount} fiscal={receipt.fiscal} onClose={() => setReceipt(null)} onPrint={() => window.print()} />
          )}
          {error && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-red-50 px-5 py-3.5 text-sm font-medium text-red-700 ring-1 ring-red-200">
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Скрыть ошибку" className="shrink-0">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          )}

          {!normalizedQuery && (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Категории</h2>
              <div className="-mx-1 mt-4 flex gap-3.5 overflow-x-auto px-1 pb-2">
                <CategoryCard emoji="🧺" name="Все товары" count={products.length} active={categoryId === ""} onClick={() => setCategoryId("")} />
                {sellableCategories.map((c) => (
                  <CategoryCard
                    key={c.id}
                    emoji={categoryEmoji(c.name)}
                    name={c.name}
                    count={categoryCounts.get(c.id) ?? 0}
                    active={categoryId === c.id}
                    onClick={() => setCategoryId(c.id)}
                  />
                ))}
              </div>
            </>
          )}

          <div className={clsx("flex items-center justify-between gap-3", normalizedQuery ? "" : "mt-6")}>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {normalizedQuery ? `Найдено: ${visibleProducts.length}` : "Выберите товар"}
            </h2>
            <button
              onClick={() => setSortMode(sortMode === "popular" ? "name" : "popular")}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-[0.9375rem] font-semibold text-foreground transition hover:bg-surface-muted"
            >
              <SlidersHorizontal className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} />
              {sortMode === "popular" ? "Ходовые сверху" : "По алфавиту"}
            </button>
          </div>

          {/* Column count follows the width of this column, not the window: as many ~14rem cards
              as fit, on the tablet and on the shop's monoblock alike. */}
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-4">
            {/* Pinned quick items (e.g. Пакет) are always first, whatever the category or search. */}
            {locationId &&
              quickItems.map((p) => (
                <ProductCard
                  key={`quick-${p.id}`}
                  pinned
                  name={p.name}
                  photo={productPhotoUrl(p)}
                  photoSlot={anyPhoto}
                  emoji={categoryEmoji(categoryNameOf(p))}
                  price={formatMoney(p.effectivePrice)}
                  unit={UNIT_LABELS_RU[p.unit]}
                  inCart={inCartLabel(p)}
                  meta={cardMeta(p, statsByProduct.get(p.id))}
                  onClick={() => {
                    addToCart(p);
                    focusScan();
                  }}
                />
              ))}
            {sortedProducts.map((p) => {
              const coupon = couponPercentForProduct(p);
              const stats = statsByProduct.get(p.id);
              return (
                <ProductCard
                  key={p.id}
                  name={p.name}
                  photo={productPhotoUrl(p)}
                  photoSlot={anyPhoto}
                  emoji={categoryEmoji(categoryNameOf(p))}
                  price={formatMoney(coupon !== null ? applyDiscountPercent(p.effectivePrice, coupon) : p.effectivePrice)}
                  oldPrice={coupon !== null ? formatMoney(p.effectivePrice) : null}
                  badge={coupon !== null ? `Купон −${coupon}%` : null}
                  unit={UNIT_LABELS_RU[p.unit]}
                  inCart={inCartLabel(p)}
                  meta={cardMeta(p, stats)}
                  onClick={() => {
                    addToCart(p);
                    focusScan();
                  }}
                />
              );
            })}
            {sortedProducts.length === 0 && quickItems.length === 0 && (
              <p className="col-span-full py-16 text-center text-base text-muted">
                {normalizedQuery ? "Ничего не найдено" : "Нет товаров для продажи"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* On a phone the check sits under the products: a bar at the bottom jumps to it. */}
      {cart.length > 0 && !checkInView && (
        <button
          onClick={() => document.getElementById("pos-check")?.scrollIntoView({ behavior: "smooth" })}
          className="fixed inset-x-4 bottom-4 z-30 flex h-14 items-center justify-between rounded-2xl bg-accent px-5 text-base font-semibold text-accent-foreground shadow-[0_10px_24px_rgba(235,88,51,0.3)] lg:hidden"
        >
          <span>Чек · {cart.length} поз.</span>
          <span>{formatMoney(total)}</span>
        </button>
      )}

      <aside
        id="pos-check"
        className="flex shrink-0 scroll-mt-4 flex-col border-t border-border bg-surface lg:h-full lg:w-[23.5rem] lg:overflow-y-auto lg:border-l lg:border-t-0 xl:w-[26rem] 2xl:w-[29rem]"
      >
        <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-6 [@media(max-height:820px)]:pt-4">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Чек
            {itemCount > 0 && <span className="ml-2 text-base font-normal text-muted">{formatQuantity(itemCount)} шт</span>}
          </h2>
          <div className="flex gap-2">
            <ToolButton icon={Ticket} label="Купон" on={!!appliedCoupon} disabled={cart.length === 0 && !appliedCoupon} onClick={() => setCouponOpen(true)} />
            <ToolButton
              icon={Percent}
              label="Скидка на чек"
              on={!!checkDiscount}
              disabled={!checkDiscount && (cart.length === 0 || !!appliedCoupon || pointsRequested > 0)}
              onClick={() => (checkDiscount ? setCheckDiscount(null) : setDiscountOpen(true))}
            />
            <ToolButton icon={Cake} label="Оплата заказа" on={!!crmOrder} onClick={() => (crmOrder ? setCrmOrder(null) : setOrderPickerOpen(true))} />
            <ToolButton
              icon={Trash2}
              label="Очистить чек"
              disabled={cart.length === 0}
              onClick={() => {
                setCart([]);
                removeCoupon();
                setLoyaltyMember(null);
                setCrmOrder(null);
                setPointsToRedeem(0);
                setCheckDiscount(null);
                focusScan();
              }}
            />
          </div>
        </div>

        {(appliedCoupon || crmOrder || (checkDiscount && checkDiscountSpread)) && (
          <div className="space-y-2 px-6 pt-2">
            {appliedCoupon && (
              <AttachedRow
                title={`Купон «${couponCode.trim().toUpperCase()}»`}
                detail={appliedCoupon.promotionName}
                onRemove={removeCoupon}
              />
            )}
            {crmOrder && (
              <AttachedRow
                title={`Заказ №${crmOrder.number} · ${crmOrder.title}`}
                detail={`${crmOrder.customerName} · к ${formatDate(crmOrder.dueAt)}${crmOrder.price !== null ? ` · ${formatMoney(crmOrder.price)}` : ""}`}
                onRemove={() => setCrmOrder(null)}
              />
            )}
            {checkDiscount && checkDiscountSpread && (
              <AttachedRow
                title={`Скидка ${checkDiscount.percent !== undefined ? `${checkDiscount.percent}%` : formatMoney(checkDiscount.amount ?? 0)}`}
                detail={checkDiscount.approverName ? `Разрешил(а): ${checkDiscount.approverName}` : "Скидка на чек"}
                onRemove={() => setCheckDiscount(null)}
              />
            )}
          </div>
        )}

        <div className="min-h-[9rem] flex-1 px-6 lg:overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex h-full min-h-[9rem] flex-col items-center justify-center text-center">
              <span className="text-4xl" aria-hidden>
                🧺
              </span>
              <p className="mt-3 text-base font-semibold text-foreground">Чек пуст</p>
              <p className="mt-1 text-sm text-muted">Нажмите на товар или отсканируйте</p>
            </div>
          ) : (
            cart.map((line) => {
              const couponPercent = couponPercentFor(line);
              const unit = displayUnitPrice(line);
              const old = line.markedDown ? line.product.effectivePrice : couponPercent !== null ? line.unitPrice : null;
              const qtyLabel = `${formatQuantity(line.quantity)}${line.product.unit === "PCS" ? "" : ` ${UNIT_LABELS_RU[line.product.unit]}`}`;
              return (
                <CheckLine
                  key={line.key}
                  name={line.product.name}
                  photo={productPhotoUrl(line.product)}
                  emoji={categoryEmoji(categoryNameOf(line.product))}
                  sub={categoryNameOf(line.product)}
                  chips={
                    <>
                      {/* Full price needs no action; the chip is only for stale goods. Not on a line the
                          coupon already discounts — the two never stack. */}
                      {!line.product.isOpenPrice && couponPercent === null && (
                        <LineChip
                          on={line.markedDown}
                          onClick={() => {
                            toggleMarkdown(line.key);
                            focusScan();
                          }}
                        >
                          Уценка −{MARKDOWN_PERCENT}%
                        </LineChip>
                      )}
                      {couponPercent !== null && (
                        <LineChip on tone="accent">
                          {appliedCoupon?.promotionName} −{couponPercent}%
                        </LineChip>
                      )}
                    </>
                  }
                  qty={qtyLabel}
                  price={line.quantity === 1 || line.product.unit !== "PCS" ? formatMoney(unit * line.quantity) : `${formatQuantity(line.quantity)} × ${formatMoney(unit)}`}
                  oldPrice={old !== null ? formatMoney(old * line.quantity) : null}
                  onMinus={() => changeLine(line.key, line.quantity - 1)}
                  onPlus={() => setLineQuantity(line.key, line.quantity + 1)}
                  onRemove={() => changeLine(line.key, 0)}
                />
              );
            })
          )}
        </div>

        <div className="shrink-0 px-6 pb-6">
          {loyaltySettings?.enabled && (
            <div className="pt-3">
              <PosLoyaltyBlock
                member={loyaltyMember}
                onMemberChange={setLoyaltyMember}
                pointsToRedeem={pointsToRedeem}
                onPointsChange={setPointsToRedeem}
                cap={pointsCap}
                discount={pointsDiscount?.total ?? 0}
              />
            </div>
          )}

          {summaryRows.length > 0 && (
            <div className="mt-4 space-y-2 text-[0.9375rem]">
              {summaryRows.map((row) => (
                <div key={row.label} className="flex justify-between gap-3">
                  <span className="text-muted">{row.label}</span>
                  <span className={clsx("font-semibold", row.negative ? "text-accent" : "text-foreground")}>{row.value}</span>
                </div>
              ))}
            </div>
          )}
          <div className="my-4 border-t-[1.5px] border-dashed border-[var(--border-strong)] [@media(max-height:820px)]:my-3" />
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-semibold text-foreground">Итого</span>
            <span className="whitespace-nowrap text-[2rem] font-semibold leading-none tracking-tight text-foreground [@media(max-height:820px)]:text-[1.75rem]">{formatMoney(total)}</span>
          </div>

          {/* The card has been charged but the sale did not record. Every payment button is blocked:
              each one would run a SECOND payment — the only way out is to record the same one again. */}
          {chargedButUnrecorded && (
            <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
              <p className="text-sm font-semibold text-amber-900">Оплата на терминале прошла, но продажа не записалась</p>
              <p className="mt-1 text-sm text-amber-800">
                Деньги с покупателя уже списаны. <strong>Не проводите оплату заново.</strong>
              </p>
              <button
                type="button"
                onClick={() => handlePay(chargedButUnrecorded)}
                disabled={isSubmitting}
                className="mt-2 h-11 w-full rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                {isSubmitting ? "…" : "Записать продажу ещё раз"}
              </button>
            </div>
          )}

          <p className="mb-3 mt-5 text-base font-semibold text-foreground [@media(max-height:820px)]:hidden">Способ оплаты</p>
          <div className="hidden h-3 [@media(max-height:820px)]:block" />
          <PayMethodCards value={payMethod} onChange={setPayMethod} disabled={chargedButUnrecorded !== null} />
          {/* Opens the payment window rather than settling on the spot: a stray tap must never be
              a completed sale, and the cashier gets one place to change their mind. */}
          <button
            type="button"
            data-submit
            onClick={() => setPayMode(payMethod)}
            disabled={cart.length === 0 || isSubmitting || !locationId || chargedButUnrecorded !== null}
            className="mt-4 h-[3.75rem] w-full rounded-2xl bg-accent [@media(max-height:820px)]:mt-3 [@media(max-height:820px)]:h-14 text-lg font-semibold text-accent-foreground shadow-[0_10px_24px_rgba(235,88,51,0.28)] transition hover:opacity-95 active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
          >
            {isSubmitting ? "…" : cart.length === 0 ? "Провести оплату" : `Провести оплату · ${formatMoney(total)}`}
          </button>
        </div>
      </aside>
    </div>
    {couponOpen && (
      <Modal
        title="Купон"
        width="max-w-md"
        onClose={() => {
          setCouponOpen(false);
          focusScan();
        }}
      >
        {appliedCoupon ? (
          <>
            <div className="rounded-2xl bg-[var(--accent-soft)] px-4 py-3">
              <p className="text-base font-semibold text-accent">{appliedCoupon.promotionName}</p>
              <p className="mt-0.5 text-sm text-muted">Купон «{couponCode.trim().toUpperCase()}» применён</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  removeCoupon();
                }}
                className="h-12 rounded-xl border border-border text-sm font-semibold text-foreground transition hover:bg-surface-muted"
              >
                Отменить купон
              </button>
              <button
                data-submit
                onClick={() => {
                  setCouponOpen(false);
                  focusScan();
                }}
                className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground transition hover:opacity-90"
              >
                Готово
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              autoFocus
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyCoupon();
                }
              }}
              placeholder="Код купона"
              className="h-14 w-full rounded-2xl border border-border bg-surface px-4 text-xl font-semibold uppercase tracking-wider text-foreground outline-none focus:border-accent"
            />
            {couponError && <p className="mt-2 text-sm text-red-700">{couponError}</p>}
            <button
              data-submit
              onClick={applyCoupon}
              disabled={!couponCode.trim() || couponLoading}
              className="mt-4 h-14 w-full rounded-2xl bg-accent text-base font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
            >
              {couponLoading ? "Проверяем…" : "Применить"}
            </button>
          </>
        )}
      </Modal>
    )}
    {orderPickerOpen && (
      <PosOrderPickerModal
        onPick={(o) => {
          setCrmOrder(o);
          setOrderPickerOpen(false);
          focusScan();
        }}
        onClose={() => {
          setOrderPickerOpen(false);
          focusScan();
        }}
      />
    )}
    {payMode === "cash" && (
      <CashPaymentModal
        total={total}
        isSubmitting={isSubmitting}
        onClose={() => {
          setPayMode(null);
          focusScan();
        }}
        onSubmit={(given) => {
          setPayMode(null);
          handlePay({ method: PaymentMethod.CASH, cashGiven: given });
        }}
      />
    )}
    {payMode === "card" && (
      <CardPaymentModal
        total={total}
        isSubmitting={isSubmitting}
        onClose={() => {
          setPayMode(null);
          focusScan();
        }}
        onSubmit={(terminalPayment) => {
          setPayMode(null);
          handlePay({ method: PaymentMethod.CARD, terminalPayment });
        }}
      />
    )}
    {payMode === "mixed" && (
      <MixedPaymentModal
        total={total}
        isSubmitting={isSubmitting}
        onClose={() => {
          setPayMode(null);
          focusScan();
        }}
        onSubmit={(card, cashPart, cashGiven, terminalPayment) => {
          setPayMode(null);
          handlePay({
            method: PaymentMethod.MIXED,
            cashGiven,
            split: [
              { method: PaymentMethod.CARD, amount: card },
              { method: PaymentMethod.CASH, amount: cashPart },
            ],
            terminalPayment,
          });
        }}
      />
    )}
    {loyaltyOpen && user && (
      <Modal
        title="Клиент по номеру телефона"
        width="max-w-2xl"
        onClose={() => {
          setLoyaltyOpen(false);
          focusScan();
        }}
      >
        <LoyaltyLookupPanel role={user.role} keypad />
      </Modal>
    )}
    {historyOpen && (
      <SaleHistoryModal
        // The point the till is currently selling at. A cashier is pinned to
        // their own by the server either way; this is what makes the owner's
        // figures match the point they picked in the header rather than
        // silently totalling the whole network.
        locationId={locationId || undefined}
        products={products}
        onClose={() => {
          setHistoryOpen(false);
          focusScan();
        }}
        onReprint={(sale) => {
          // Close first, print after: the dialog would otherwise end up on
          // the printed slip.
          setHistoryOpen(false);
          setReprintSale(sale);
        }}
      />
    )}
    {labelsOpen && (
      <LabelPrintPicker
        // Own production only. A bought-in packet already carries the
        // manufacturer's own label; the sticker exists for the cake that has
        // nothing on it.
        products={products.filter((p) => p.type === ProductType.FINISHED_GOOD)}
        onClose={() => {
          setLabelsOpen(false);
          focusScan();
        }}
      />
    )}
    {discountOpen && (
      <CheckDiscountModal
        base={discountBase}
        needsApproval={!isApprover}
        locationId={locationId || undefined}
        onApply={(d) => {
          setCheckDiscount(d);
          setDiscountOpen(false);
        }}
        onClose={() => setDiscountOpen(false)}
      />
    )}
    {pinLoginOpen && <PinLoginModal onClose={() => setPinLoginOpen(false)} />}
    {pendingLine && (
      <SeniorPinModal
        action="LINE_REMOVAL"
        locationId={locationId || undefined}
        detail={pendingLine.detail}
        onApproved={() => {
          setLineQuantity(pendingLine.key, pendingLine.quantity);
          setPendingLine(null);
        }}
        onClose={() => setPendingLine(null)}
      />
    )}
    {terminalSettingsOpen && (
      <Modal
        title="Терминал Kaspi"
        onClose={() => {
          setTerminalSettingsOpen(false);
          focusScan();
        }}
        width="max-w-lg"
      >
        <TerminalConnectionForm onStatusChange={setTerminalPaired} />
      </Modal>
    )}
    {screenPicker && (
      <CustomerScreenPickerModal
        screens={screenPicker.screens}
        hostIndex={screenPicker.hostIndex}
        onClose={() => {
          setScreenPicker(null);
          focusScan();
        }}
      />
    )}
    {/* A reprint wins over the sale just rung up, and carries no cash
        details — how much was handed over is not stored, and inventing it
        on a reprint would put a made-up «Сдача» on a real receipt. */}
    {(reprintSale ?? lastSale) && (
      <PrintableReceipt
        sale={(reprintSale ?? lastSale)!}
        cash={reprintSale ? null : cashDetails}
        orgName={user?.organization.name ?? ""}
      />
    )}
    </div>
  );
}

// Takes the cash handed over and shows the change before the sale is put
// through, so the cashier never has to reach for a calculator with a queue
// waiting. The quick buttons cover what actually gets handed over: the exact
// amount, and the notes just above it.
function CashPaymentModal({
  total,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  total: number;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (given: number) => void;
}) {
  const [value, setValue] = useState("");
  const given = value ? Number(value) : 0;
  const change = given - total;
  // Handing over less than the price is not a sale this screen can settle —
  // a walk-in sale is paid in full. Exactly the price is fine (no change).
  const valid = given >= total;
  const submit = () => {
    if (valid && !isSubmitting) onSubmit(given);
  };

  return (
    <Modal title="Оплата наличными" onClose={onClose} width="max-w-md">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-muted">К оплате</span>
        <span className="text-xl font-semibold text-foreground">{formatMoney(total)}</span>
      </div>

      <div className="rounded-xl border border-border bg-surface-muted px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Получено</span>
          {/* Plain text, never an <input>: an input is what makes the
              моноблок's own on-screen keyboard appear. */}
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {value ? formatMoney(given) : "—"}
          </span>
        </div>
      </div>

      <div
        className={clsx(
          "mt-2 flex items-baseline justify-between rounded-xl px-4 py-3",
          change > 0 ? "bg-emerald-50" : "bg-surface-muted",
        )}
      >
        <span className={clsx("text-sm", change > 0 ? "text-emerald-700" : "text-muted")}>Сдача</span>
        <span
          className={clsx(
            "text-2xl font-semibold tabular-nums",
            change > 0 ? "text-emerald-700" : "text-muted",
          )}
        >
          {valid ? formatMoney(change) : "—"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {quickCashAmounts(total).map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => setValue(String(amount))}
            className="h-12 whitespace-nowrap rounded-xl border border-border px-1 text-[0.9375rem] font-semibold text-foreground transition hover:bg-surface-muted"
          >
            {amount === total ? "Без сдачи" : amount.toLocaleString("ru-RU")}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <NumberPad value={value} onChange={setValue} onSubmit={submit} />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!valid || isSubmitting}
        className="mt-4 h-14 w-full rounded-2xl bg-accent px-4 text-base font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        {isSubmitting ? "…" : "Провести продажу"}
      </button>
    </Modal>
  );
}

// A card settles the exact amount, so there is nothing to work out — this
// exists purely so a stray tap on «Карта» cannot complete a sale on its own,
// and so the cashier has somewhere to back out after the terminal declines.
function CardPaymentModal({
  total,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  total: number;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (terminalPayment?: PayArgs["terminalPayment"]) => void;
}) {
  // Read once on open, not on every render: unpairing the terminal midway
  // through a payment must not swap the dialog out from under the cashier.
  const [paired] = useState(isTerminalConfigured);
  const [busy, setBusy] = useState(false);

  const paid = useCallback(
    (tx: KaspiTransaction) =>
      onSubmit({ method: tx.method, transactionId: tx.transactionId, cardMask: tx.cardMask }),
    [onSubmit],
  );

  return (
    // A live payment on the terminal pins the dialog open — closing it would
    // leave the card being charged with nothing watching the result.
    <Modal title="Оплата картой" onClose={busy ? () => {} : onClose} width="max-w-md">
      <div className="rounded-xl border border-border bg-surface-muted px-4 py-5 text-center">
        <p className="text-sm text-muted">К оплате</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{formatMoney(total)}</p>
      </div>

      {paired ? (
        <TerminalPaymentPanel
          amount={total}
          onPaid={paid}
          onBusyChange={setBusy}
          onManual={() => onSubmit()}
        />
      ) : (
        // No terminal paired on this machine — the original flow, untouched:
        // the cashier rings the card up on the terminal by hand and says so.
        <>
          <p className="mt-3 text-xs text-muted">
            Проведите оплату на терминале, затем подтвердите. Продажа запишется только после
            подтверждения.
          </p>
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={isSubmitting}
            className="mt-4 h-14 w-full rounded-2xl bg-accent px-4 text-base font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {isSubmitting ? "…" : "Оплата прошла — провести продажу"}
          </button>
        </>
      )}

      {!busy && (
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-surface-muted disabled:opacity-40"
        >
          Отмена
        </button>
      )}
    </Modal>
  );
}

// Part on a card, the rest in cash — a real request at the counter, and one
// that has to be recorded as two payments, because the two halves genuinely
// end up in different accounts.
//
// Still only ONE of the two halves is ever typed — the other is the
// remainder, so they can never fail to add up and an unbalanced split is not
// expressible. What changed is WHICH half: either, whichever the cashier taps.
//
// Cash leads and is selected by default, because that is the half the buyer
// states: they say «630 наличкой, остальное картой», since cash is what is
// physically in their hand. Card-first was the original guess and made the
// cashier do the subtraction the till exists to do. Tapping the other row
// switches the keypad to it, seeded with what that row currently shows so
// the numbers never jump under the finger.
//
// «Получено наличными» is a third, separate number: what the buyer actually
// handed over for the cash half, for change.
function MixedPaymentModal({
  total,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  total: number;
  isSubmitting: boolean;
  onClose: () => void;
  // (card part, cash part, cash actually handed over, terminal transaction)
  onSubmit: (
    card: number,
    cash: number,
    cashGiven: number,
    terminalPayment?: PayArgs["terminalPayment"],
  ) => void;
}) {
  // The split is held as ONE number — the cash half — no matter which row is
  // being typed into. The card half is always the remainder, so the two can
  // never fail to add up. Null until the cashier has decided anything.
  const [cashAmount, setCashAmount] = useState<number | null>(null);
  const [splitSide, setSplitSide] = useState<"cash" | "card">("cash");
  // Digits typed since this row was selected. Kept separate from cashAmount
  // so that switching rows does not make the next keypress append to the
  // number already showing there — tapping «Картой» after typing 630 must let
  // 200 mean two hundred, not 170200.
  const [buffer, setBuffer] = useState("");
  const [givenValue, setGivenValue] = useState("");
  // Which number the keypad is driving: the split, or the cash handed over.
  const [field, setField] = useState<"split" | "given">("split");
  const [paired] = useState(isTerminalConfigured);
  // The split is frozen before the card half goes to the terminal: the amount
  // on the terminal's screen and the amount in this dialog must be the same
  // number, and a keypad still live under an open payment could part them.
  const [settling, setSettling] = useState(false);
  const [busy, setBusy] = useState(false);

  function onSplitDigits(next: string) {
    setBuffer(next);
    if (next === "") {
      setCashAmount(null);
      return;
    }
    const typed = Number(next);
    setCashAmount(splitSide === "cash" ? typed : total - typed);
  }

  // Switching rows keeps the amounts on screen exactly as they are — only the
  // keypad moves.
  function selectSide(side: "cash" | "card") {
    setField("split");
    if (side === splitSide) return;
    setSplitSide(side);
    setBuffer("");
  }

  const decided = cashAmount !== null;
  // Out of range means the typed half exceeded the sale, which would make the
  // other half negative. Refused rather than silently rebalanced.
  const overpaid = decided && (cashAmount < 0 || cashAmount > total);
  const cashPart = Math.min(Math.max(cashAmount ?? 0, 0), total);
  const cardPart = total - cashPart;
  // Untouched, the buyer hands over exactly the cash half and there is no
  // change — the common case needs no third number at all.
  const given = givenValue ? Number(givenValue) : cashPart;
  const change = given - cashPart;

  // Both halves must be real money, otherwise this is a single-method sale
  // and belongs on the «Наличные» or «Карта» button.
  const valid = decided && !overpaid && cashPart > 0 && cardPart > 0 && given >= cashPart && !isSubmitting;
  const submit = () => {
    if (valid) onSubmit(cardPart, cashPart, given);
  };
  // Freezes the split, then hands the card half to the terminal.
  const lockSplit = () => {
    if (valid) setSettling(true);
  };
  const paidOnTerminal = useCallback(
    (tx: KaspiTransaction) =>
      onSubmit(cardPart, cashPart, given, {
        method: tx.method,
        transactionId: tx.transactionId,
        cardMask: tx.cardMask,
      }),
    [onSubmit, cardPart, cashPart, given],
  );

  return (
    <Modal title="Картой и наличными" onClose={busy ? () => {} : onClose} width="max-w-md">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-muted">К оплате</span>
        <span className="text-xl font-semibold text-foreground">{formatMoney(total)}</span>
      </div>

      {/* Both halves are tappable, and whichever is tapped becomes the one
          being typed. Cash sits first because it is the half the buyer
          names. */}
      <button
        type="button"
        onClick={() => selectSide("cash")}
        disabled={settling}
        className={clsx(
          "flex w-full items-baseline justify-between rounded-xl border px-4 py-3 text-left transition",
          field === "split" && splitSide === "cash" ? "border-accent bg-surface" : "border-border bg-surface-muted",
        )}
      >
        <span className="text-sm text-muted">Наличными</span>
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {decided ? formatMoney(cashPart) : "—"}
        </span>
      </button>

      <button
        type="button"
        onClick={() => selectSide("card")}
        disabled={settling}
        className={clsx(
          "mt-2 flex w-full items-baseline justify-between rounded-xl border px-4 py-3 text-left transition",
          field === "split" && splitSide === "card" ? "border-accent bg-surface" : "border-border bg-surface-muted",
        )}
      >
        <span className="text-sm text-muted">Картой</span>
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {decided ? formatMoney(cardPart) : "—"}
        </span>
      </button>

      {decided && !overpaid && cashPart > 0 && (
        <>
          <button
            type="button"
            onClick={() => setField("given")}
            disabled={settling}
            className={clsx(
              "mt-2 flex w-full items-baseline justify-between rounded-xl border px-4 py-3 text-left transition",
              field === "given" ? "border-accent bg-surface" : "border-border bg-surface-muted",
            )}
          >
            <span className="text-sm text-muted">Получено наличными</span>
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {formatMoney(given)}
            </span>
          </button>
          {change > 0 && (
            <div className="mt-2 flex items-baseline justify-between rounded-xl bg-emerald-50 px-4 py-3">
              <span className="text-sm text-emerald-700">Сдача</span>
              <span className="text-2xl font-semibold tabular-nums text-emerald-700">
                {formatMoney(change)}
              </span>
            </div>
          )}
        </>
      )}

      {!settling && (
        <>
          <div className="mt-3">
            <NumberPad
              value={field === "split" ? buffer : givenValue}
              onChange={field === "split" ? onSplitDigits : setGivenValue}
              onSubmit={paired ? lockSplit : submit}
            />
          </div>

          <button
            type="button"
            onClick={paired ? lockSplit : submit}
            disabled={!valid}
            className="mt-4 h-14 w-full rounded-2xl bg-accent px-4 text-base font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {isSubmitting ? "…" : paired ? `Оплатить картой ${formatMoney(cardPart)}` : "Провести продажу"}
          </button>
        </>
      )}

      {settling && (
        <>
          <TerminalPaymentPanel
            amount={cardPart}
            onPaid={paidOnTerminal}
            onBusyChange={setBusy}
            onManual={submit}
          />
          {!busy && (
            <button
              type="button"
              onClick={() => setSettling(false)}
              className="mt-2 w-full rounded-xl px-4 py-2.5 text-xs font-medium text-muted transition hover:bg-surface-muted"
            >
              Изменить суммы
            </button>
          )}
        </>
      )}
      {overpaid && (
        <p className="mt-2 text-center text-xs text-red-700">
          Больше суммы чека — {formatMoney(total)}
        </p>
      )}
      {!overpaid && decided && cardPart === 0 && (
        <p className="mt-2 text-center text-xs text-muted">
          Всё наличными — используйте кнопку «Наличные»
        </p>
      )}
      {!overpaid && decided && cashPart === 0 && (
        <p className="mt-2 text-center text-xs text-muted">
          Всё на карте — используйте кнопку «Карта»
        </p>
      )}
    </Modal>
  );
}

// The exact amount, then the next few round notes above it. Anything already
// smaller than the total is useless as a suggestion, and duplicates are
// dropped so «Без сдачи» never appears twice.
function quickCashAmounts(total: number): number[] {
  const notes = [500, 1000, 2000, 5000, 10000, 20000];
  const above = notes.filter((n) => n > total);
  const rounded = Math.ceil(total / 1000) * 1000;
  const suggestions = [total, ...(rounded > total ? [rounded] : []), ...above];
  return suggestions.filter((amount, i) => suggestions.indexOf(amount) === i).slice(0, 4);
}

// Asks for the amount of an open-price line, on the same keypad as the cash
// dialog — for the same reason: no <input>, no OS keyboard.
// Print-only: invisible on screen (`hidden print:block`), rendered instead of
// the interactive till when the browser's print dialog fires — a slip
// shaped like an actual receipt rather than a screenshot of the whole page
// with buttons and a sidebar in it.
function PrintableReceipt({
  sale,
  cash,
  orgName,
}: {
  sale: SaleDetailDto;
  cash: { given: number; change: number } | null;
  // The brand, not the till: a buyer's slip should say «Ar-Amir», the name
  // on the storefront, not the internal location name (which for a rented
  // corner of someone else's supermarket may not even be a shop name at
  // all — see the Мерей/Фазиза case that prompted this).
  orgName: string;
}) {
  return (
    <div className="hidden print:block print:mx-auto print:max-w-xs print:text-black">
      <p className="text-center text-sm font-semibold">{orgName}</p>
      <p className="text-center text-xs">{sale.locationName}</p>
      {sale.number && <p className="text-center text-xs font-semibold">Чек № {sale.number}</p>}
      <p className="text-center text-xs">{new Date(sale.soldAt).toLocaleString("ru-RU")}</p>
      <div className="my-3 border-t border-dashed border-black" />
      <table className="w-full text-xs">
        <tbody>
          {sale.items.map((item) => (
            <Fragment key={item.id}>
              <tr>
                <td colSpan={2} className="pt-2">
                  {item.productName}
                </td>
              </tr>
              <tr>
                <td className="pt-0.5">
                  {formatQuantity(item.quantity)} × {formatMoney(item.unitPrice)}
                  {/* The buyer should see they got the discount, and the
                      slip is the only record they take home. A promotion
                      discount is labelled by its own name, never "уценка" —
                      that word means stale goods, and a coupon is not that. */}
                  {item.fullUnitPrice !== null &&
                    (item.promotionName
                      ? ` (по акции «${item.promotionName}», было ${formatMoney(item.fullUnitPrice)})`
                      : item.loyaltyDiscount
                        ? ` (оплачено баллами ${formatMoney(item.loyaltyDiscount)}, было ${formatMoney(item.fullUnitPrice)})`
                        : ` (уценка, было ${formatMoney(item.fullUnitPrice)})`)}
                </td>
                <td className="pt-0.5 text-right">{formatMoney(item.subtotal)}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="my-3 border-t border-dashed border-black" />
      <div className="flex justify-between text-sm font-semibold">
        <span>Итого</span>
        <span>{formatMoney(sale.totalAmount)}</span>
      </div>
      {/* A split sale prints each tender; anything else prints its one
          method. Reading the label off the shared map rather than a
          CASH-or-else ternary, which printed «Карта» for a transfer and
          would now print it for a mixed sale too.
          `sale.payments ?? []`, not `sale.payments`: this block renders
          right after every sale (the print-only div is hidden by CSS, not
          by React, so it still executes), and if the API server is a build
          behind the web app — which has happened before on this project —
          `payments` would be missing from its response entirely rather than
          an empty array. That crashed the whole till after every single
          sale until this guard, on every browser, because it really was
          the deployed code faulting against a stale server reply. */}
      {(sale.payments ?? []).length > 0 ? (
        <div className="mt-1 text-xs">
          {sale.payments.map((p) => (
            <div key={p.method} className="flex justify-between">
              <span>{PAYMENT_METHOD_LABELS_RU[p.method]}</span>
              <span>{formatMoney(p.amount)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs">{PAYMENT_METHOD_LABELS_RU[sale.paymentMethod]}</p>
      )}
      {/* `sale.loyalty &&` also covers an older API that sends no such field. */}
      {sale.loyalty && (
        <div className="mt-1 text-xs">
          {sale.loyalty.pointsRedeemed > 0 && (
            <div className="flex justify-between">
              <span>Оплачено баллами</span>
              <span>{formatPoints(sale.loyalty.pointsRedeemed)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Начислено баллов</span>
            <span>{formatPoints(sale.loyalty.pointsEarned)}</span>
          </div>
        </div>
      )}
      {cash && cash.change > 0 && (
        <div className="mt-1 text-xs">
          <div className="flex justify-between">
            <span>Получено</span>
            <span>{formatMoney(cash.given)}</span>
          </div>
          <div className="flex justify-between">
            <span>Сдача</span>
            <span>{formatMoney(cash.change)}</span>
          </div>
        </div>
      )}
      {sale.fiscalReceipt?.ticketNumber && (
        <>
          <div className="my-3 border-t border-dashed border-black" />
          <p className="text-center text-xs">Фискальный чек № {sale.fiscalReceipt.ticketNumber}</p>
          {sale.fiscalReceipt.qrCode && (
            <div className="mt-2 flex justify-center">
              <QRCodeSVG value={sale.fiscalReceipt.qrCode} size={96} fgColor="#000000" bgColor="#ffffff" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Shown after a fiscalised sale. Stays until the cashier closes it or starts
// the next order — the buyer needs long enough to scan the QR.
function ReceiptPanel({
  amount,
  fiscal,
  onClose,
  onPrint,
}: {
  amount: number;
  fiscal: SaleFiscalReceiptDto;
  onClose: () => void;
  onPrint: () => void;
}) {
  const registered = fiscal.status === FiscalReceiptStatus.REGISTERED;

  return (
    <div className="mb-4 flex items-start gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      {fiscal.qrCode && (
        // Fixed black-on-white regardless of theme: a QR has to stay
        // high-contrast to be readable by a phone camera, so this is the one
        // place that deliberately does not follow the theme tokens.
        <div className="shrink-0 rounded-lg bg-white p-2">
          <QRCodeSVG value={fiscal.qrCode} size={104} fgColor="#000000" bgColor="#ffffff" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-emerald-800">Продажа проведена — {formatMoney(amount)}</p>
        {fiscal.ticketNumber && (
          <p className="mt-1 font-mono text-lg font-semibold tracking-tight text-emerald-900">
            Чек № {fiscal.ticketNumber}
          </p>
        )}
        {!registered && (
          <p className="mt-1 text-sm text-amber-700">
            Чек не подтверждён кассой. Проверьте раздел «Требует внимания».
          </p>
        )}
        {registered && fiscal.isOffline && (
          <p className="mt-1 text-sm text-amber-700">
            Чек пробит офлайн. Проверка по QR заработает после синхронизации кассы.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onPrint}
          aria-label="Печать чека"
          className="rounded-lg border border-emerald-200 bg-white p-1.5 text-emerald-700 transition hover:bg-emerald-50"
        >
          <Printer className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button onClick={onClose} aria-label="Закрыть чек" className="text-emerald-700">
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

// Something attached to the whole check (a coupon, a cake order, a check discount), removable.
function AttachedRow({ title, detail, onRemove }: { title: string; detail: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[var(--accent-soft)] px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-accent">{title}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <button onClick={onRemove} aria-label="Убрать" className="shrink-0 rounded-lg p-1 text-muted transition hover:text-red-600">
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
