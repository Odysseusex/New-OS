import React from "react";
import { Document, Page, Text, View, Image, Font, StyleSheet, pdf } from "@react-pdf/renderer";
import JsBarcode from "jsbarcode";
import type { PromotionDto } from "@bakery-os/shared";
import { formatDate } from "@/lib/format";

// Same Cyrillic-capable font as recipe-pdf.tsx, registered again here
// because this module is its own dynamically-imported chunk (see
// downloadCouponsPdf's caller) — @react-pdf's Font registry is per module
// graph, not shared automatically across separately lazy-loaded chunks.
Font.register({
  family: "Liberation Sans",
  fonts: [
    { src: "/fonts/LiberationSans-Regular.ttf", fontWeight: "normal", fontStyle: "normal" },
    { src: "/fonts/LiberationSans-Bold.ttf", fontWeight: "bold", fontStyle: "normal" },
  ],
});

const COLOR_ACCENT = "#a85333";
const COLOR_FOREGROUND = "#1c1917";
const COLOR_MUTED = "#78716c";
const COLOR_BORDER = "#a8a29e";

// A4 usable area after a safe printer margin, split into a 2-column grid.
// Row height is the one number that changes with density; everything else
// (column width, gutter) stays the same regardless of how many rows fit.
//
// cardHeight below is deliberately well under what the arithmetic alone
// allows (rows * cardHeight + (rows-1) * GUTTER + 2 * PAGE_PADDING must be
// <= A4's 841.89pt) — react-pdf's own line-height rendering runs a bit
// taller than the nominal font-size math suggests, and a page whose
// content is even a point too tall silently spills a row onto a phantom
// extra physical page instead of erroring. Caught exactly this way: 8
// logical pages of 8 coupons rendered as 15 actual PDF pages until this
// margin was added.
const PAGE_PADDING = 20;
const GUTTER = 8;
const CARD_WIDTH = 269;

export type CouponDensity = 8 | 10;

const DENSITY_CONFIG: Record<CouponDensity, { rows: number; cardHeight: number; compact: boolean }> = {
  8: { rows: 4, cardHeight: 185, compact: false },
  10: { rows: 5, cardHeight: 145, compact: true },
};

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

// "7K3PXQ" -> "7K3 PXQ" — purely a print-time display grouping (the stored
// code is unchanged), so a code copied by hand from the coupon is less
// likely to lose or transpose a character than one long unbroken run.
function formatCodeForDisplay(code: string): string {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

// Groups this promotion's rules by their percent, so "Хлеб 50%, Выпечка
// 50%, Торты 30%" prints as "Хлеб, Выпечка −50%" / "Торты −30%" rather than
// one line per category — three rules sharing two percents is exactly the
// Merey pilot's own shape, and this reads correctly for any other grouping
// too, not just that one.
function groupRulesByPercent(rules: PromotionDto["rules"]): { percent: number; categoryNames: string }[] {
  const byPercent = new Map<number, string[]>();
  for (const rule of rules) {
    const names = byPercent.get(rule.discountPercent) ?? [];
    names.push(rule.categoryName);
    byPercent.set(rule.discountPercent, names);
  }
  return Array.from(byPercent.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([percent, names]) => ({
      percent,
      categoryNames: names.length <= 2 ? names.join(" и ") : `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`,
    }));
}

// Renders CODE128 onto an offscreen canvas and reads it back as a PNG data
// URI — @react-pdf/renderer has no live DOM to point a barcode library at
// (unlike the thermal label sheet, which prints through the real browser
// print pipeline), so the barcode has to already be a static image by the
// time the PDF document is built.
function codeToBarcodeDataUri(code: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, code, {
    format: "CODE128",
    width: 2,
    height: 44,
    displayValue: false,
    margin: 0,
    background: "#ffffff",
    lineColor: "#000000",
  });
  return canvas.toDataURL("image/png");
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Liberation Sans",
    padding: PAGE_PADDING,
  },
  row: {
    flexDirection: "row",
  },
  card: {
    width: CARD_WIDTH,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLOR_BORDER,
    borderRadius: 4,
    padding: 10,
    marginRight: GUTTER,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  cardEmpty: {
    width: CARD_WIDTH,
    marginRight: GUTTER,
  },
  brand: {
    color: COLOR_MUTED,
  },
  promotionName: {
    fontWeight: "bold",
    color: COLOR_FOREGROUND,
    marginTop: 1,
  },
  discountLine: {
    fontWeight: "bold",
    color: COLOR_ACCENT,
    marginTop: 2,
  },
  code: {
    fontFamily: "Courier",
    fontWeight: "bold",
    letterSpacing: 1.5,
    textAlign: "center",
  },
  meta: {
    color: COLOR_MUTED,
  },
  fineprint: {
    color: COLOR_MUTED,
  },
});

// Font sizes and spacing scale down for the denser 10-per-sheet layout
// (150pt-tall cards vs. 190pt) — without this, the same sizes that fit
// comfortably at 8-per-sheet clip the barcode or the fine print at 10.
function textSizes(compact: boolean) {
  return {
    brand: compact ? 6 : 7,
    promotionName: compact ? 9.5 : 11,
    discountLine: compact ? 9.5 : 11,
    code: compact ? 16 : 19,
    codeMarginTop: compact ? 2 : 4,
    barcodeHeight: compact ? 20 : 26,
    barcodeMarginTop: compact ? 2 : 3,
    meta: compact ? 6.5 : 7,
    fineprint: compact ? 6 : 6,
  };
}

interface CouponCardProps {
  code: string;
  promotion: PromotionDto;
  ruleGroups: { percent: number; categoryNames: string }[];
  barcodeDataUri: string | null;
  validity: string;
  height: number;
  compact: boolean;
  lastInRow: boolean;
}

function CouponCard({ code, promotion, ruleGroups, barcodeDataUri, validity, height, compact, lastInRow }: CouponCardProps) {
  const sizes = textSizes(compact);
  return (
    <View style={[styles.card, { height }, lastInRow ? { marginRight: 0 } : {}]} wrap={false}>
      <View>
        <Text style={[styles.brand, { fontSize: sizes.brand }]}>Пекарня «Колосок» · ArAmir</Text>
        <Text style={[styles.promotionName, { fontSize: sizes.promotionName }]}>{promotion.name}</Text>
        {ruleGroups.map((g) => (
          <Text key={g.percent} style={[styles.discountLine, { fontSize: sizes.discountLine }]}>
            {g.categoryNames} −{g.percent}%
          </Text>
        ))}
      </View>
      <View>
        <Text style={[styles.code, { fontSize: sizes.code, marginTop: sizes.codeMarginTop }]}>
          {formatCodeForDisplay(code)}
        </Text>
        {barcodeDataUri && (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image is a PDF primitive, not HTML img
          <Image
            style={{
              height: sizes.barcodeHeight,
              marginTop: sizes.barcodeMarginTop,
              alignSelf: "center",
              width: "80%",
            }}
            src={barcodeDataUri}
          />
        )}
      </View>
      <View>
        <Text style={[styles.meta, { fontSize: sizes.meta }]}>
          Действует {validity}
          {promotion.locationName ? ` · ${promotion.locationName}` : ""}
        </Text>
        <Text style={[styles.fineprint, { fontSize: sizes.fineprint }]}>1 купон = 1 покупка</Text>
      </View>
    </View>
  );
}

interface CouponsPageProps {
  codes: string[];
  promotion: PromotionDto;
  density: CouponDensity;
  ruleGroups: { percent: number; categoryNames: string }[];
  barcodeByCode: Map<string, string> | null;
  validity: string;
}

function CouponsPage({ codes, promotion, density, ruleGroups, barcodeByCode, validity }: CouponsPageProps) {
  const rows = chunk(codes, 2);
  const { cardHeight, compact } = DENSITY_CONFIG[density];
  return (
    <Page size="A4" style={styles.page}>
      {rows.map((rowCodes, i) => (
        <View key={i} style={i < rows.length - 1 ? [styles.row, { marginBottom: GUTTER }] : styles.row}>
          {rowCodes.map((code, colIndex) => (
            <CouponCard
              key={code}
              code={code}
              promotion={promotion}
              ruleGroups={ruleGroups}
              barcodeDataUri={barcodeByCode?.get(code) ?? null}
              validity={validity}
              height={cardHeight}
              compact={compact}
              lastInRow={colIndex === rowCodes.length - 1}
            />
          ))}
          {/* An odd leftover on the very last page still needs a second
              column-width placeholder, or the lone card would stretch to
              fill the row and print wider than every other coupon. */}
          {rowCodes.length === 1 && <View style={styles.cardEmpty} />}
        </View>
      ))}
    </Page>
  );
}

interface CouponsPdfDocumentProps {
  promotion: PromotionDto;
  codes: string[];
  density: CouponDensity;
  barcodeByCode: Map<string, string> | null;
}

function CouponsPdfDocument({ promotion, codes, density, barcodeByCode }: CouponsPdfDocumentProps) {
  const perSheet = DENSITY_CONFIG[density].rows * 2;
  const pages = chunk(codes, perSheet);
  const ruleGroups = groupRulesByPercent(promotion.rules);
  const validity = `${formatDate(promotion.startAt)}–${formatDate(promotion.endAt)}`;

  return (
    <Document title={`Купоны — ${promotion.name}`} author="ArAmir OS">
      {pages.map((pageCodes, i) => (
        <CouponsPage
          key={i}
          codes={pageCodes}
          promotion={promotion}
          density={density}
          ruleGroups={ruleGroups}
          barcodeByCode={barcodeByCode}
          validity={validity}
        />
      ))}
    </Document>
  );
}

export async function downloadCouponsPdf(params: {
  promotion: PromotionDto;
  codes: string[];
  density: CouponDensity;
  includeBarcode: boolean;
  // Shown in the filename so two downloads of two different batches never
  // silently overwrite one another in the Downloads folder.
  batchSuffix: string;
}): Promise<void> {
  const barcodeByCode = params.includeBarcode
    ? new Map(params.codes.map((code) => [code, codeToBarcodeDataUri(code)]))
    : null;

  const blob = await pdf(
    <CouponsPdfDocument
      promotion={params.promotion}
      codes={params.codes}
      density={params.density}
      barcodeByCode={barcodeByCode}
    />,
  ).toBlob();

  const filename = `Купоны — ${params.promotion.name} — ${params.batchSuffix} (${params.codes.length} шт).pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
