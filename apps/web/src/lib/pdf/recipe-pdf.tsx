import React from "react";
import { Document, Page, Text, View, Image, Font, StyleSheet, pdf } from "@react-pdf/renderer";
import { RecipeDto, RECIPE_PARAMETER_KIND_UNIT_RU, UNIT_LABELS_RU } from "@bakery-os/shared";
import { formatMoney, formatMoneyPrecise, formatQuantity, formatDate } from "@/lib/format";

// Standard 14 PDF fonts have no Cyrillic glyphs — Liberation Sans (metric-
// compatible with Arial, SIL OFL licensed) is embedded instead. Registered
// once at module load; this module is only ever reached via a dynamic
// import (see production/page.tsx), so it never loads on the main bundle.
Font.register({
  family: "Liberation Sans",
  fonts: [
    { src: "/fonts/LiberationSans-Regular.ttf", fontWeight: "normal", fontStyle: "normal" },
    { src: "/fonts/LiberationSans-Bold.ttf", fontWeight: "bold", fontStyle: "normal" },
    { src: "/fonts/LiberationSans-Italic.ttf", fontWeight: "normal", fontStyle: "italic" },
    { src: "/fonts/LiberationSans-BoldItalic.ttf", fontWeight: "bold", fontStyle: "italic" },
  ],
});

const COLOR_ACCENT = "#c2704a";
const COLOR_FOREGROUND = "#1c1917";
const COLOR_MUTED = "#78716c";
const COLOR_BORDER = "#e7e2da";
const COLOR_SURFACE_MUTED = "#f1eee9";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Liberation Sans",
    fontSize: 9,
    color: COLOR_FOREGROUND,
    paddingTop: 28,
    paddingBottom: 34,
    paddingHorizontal: 36,
  },
  eyebrow: {
    fontSize: 8,
    fontWeight: "bold",
    color: COLOR_ACCENT,
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_BORDER,
  },
  metaBlock: {
    marginRight: 22,
    marginBottom: 4,
  },
  metaLabel: {
    fontSize: 7,
    color: COLOR_MUTED,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 9.5,
    fontWeight: "bold",
  },
  notesText: {
    fontSize: 8.5,
    fontStyle: "italic",
    color: COLOR_MUTED,
    marginBottom: 8,
    lineHeight: 1.3,
  },
  sectionHeading: {
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 5,
    marginTop: 4,
  },
  doughWeightText: {
    fontSize: 8,
    color: COLOR_MUTED,
    marginBottom: 4,
  },
  table: {
    marginBottom: 8,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: COLOR_SURFACE_MUTED,
    paddingVertical: 3.5,
    paddingHorizontal: 5,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3.5,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_BORDER,
  },
  tableCellHeader: {
    fontSize: 7,
    fontWeight: "bold",
    color: COLOR_MUTED,
    textTransform: "uppercase",
  },
  tableCell: {
    fontSize: 8.5,
  },
  colIngredient: { flexGrow: 1, flexBasis: 0 },
  colQty: { width: 60, textAlign: "right" },
  colUnit: { width: 42, textAlign: "right" },
  colPercent: { width: 60, textAlign: "right" },
  stageBlock: {
    marginBottom: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_BORDER,
  },
  stageHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  stageNumber: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: COLOR_ACCENT,
    color: "#ffffff",
    fontSize: 7,
    fontWeight: "bold",
    textAlign: "center",
    paddingTop: 2.3,
    marginRight: 6,
  },
  stageName: {
    fontSize: 9,
    fontWeight: "bold",
  },
  stageParams: {
    fontSize: 7.5,
    color: COLOR_MUTED,
    marginLeft: 19,
    marginTop: 1.5,
  },
  stageNote: {
    fontSize: 7.5,
    marginLeft: 19,
    marginTop: 1.5,
    lineHeight: 1.3,
  },
  economicsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 3,
  },
  economicsCard: {
    width: 232,
    backgroundColor: COLOR_SURFACE_MUTED,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 9,
    marginRight: 12,
    marginBottom: 6,
  },
  economicsLabel: {
    fontSize: 7,
    color: COLOR_MUTED,
    marginBottom: 2,
  },
  economicsValue: {
    fontSize: 11.5,
    fontWeight: "bold",
  },
  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
    paddingTop: 6,
  },
  footerBrand: {
    flexDirection: "row",
    alignItems: "center",
  },
  footerLogo: {
    width: 12,
    height: 12,
    marginRight: 4,
    borderRadius: 3,
  },
  footerText: {
    fontSize: 7.5,
    color: COLOR_MUTED,
  },
});

function formatStageParams(stage: RecipeDto["stages"][number]): string {
  return stage.parameters
    .map((p) => {
      const unit = RECIPE_PARAMETER_KIND_UNIT_RU[p.kind];
      const label = p.label ? `${p.label}: ` : "";
      return `${label}${formatQuantity(p.value)} ${unit}`;
    })
    .join(" · ");
}

interface RecipePageProps {
  recipe: RecipeDto;
  showPrice: boolean;
  printDate: string;
}

function RecipePage({ recipe, showPrice, printDate }: RecipePageProps) {
  const showPercentColumn = recipe.items.some((item) => item.percentOfDoughWeight !== null);

  return (
    <Page size="A4" style={styles.page} wrap>
      <Text style={styles.eyebrow}>ТЕХНОЛОГИЧЕСКАЯ КАРТА</Text>
      <Text style={styles.title}>{recipe.productName}</Text>

      <View style={styles.metaRow}>
        <View style={styles.metaBlock}>
          <Text style={styles.metaLabel}>Выход</Text>
          <Text style={styles.metaValue}>
            {formatQuantity(recipe.yieldQuantity)} {UNIT_LABELS_RU[recipe.productUnit]}
          </Text>
        </View>
        {recipe.pieceWeightG !== null && (
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Вес изделия</Text>
            <Text style={styles.metaValue}>{formatQuantity(recipe.pieceWeightG)} г</Text>
          </View>
        )}
        {recipe.shelfLifeDays !== null && (
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Срок годности</Text>
            <Text style={styles.metaValue}>{formatQuantity(recipe.shelfLifeDays)} дн.</Text>
          </View>
        )}
        {recipe.lossPercent !== null && (
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Производственные потери</Text>
            <Text style={styles.metaValue}>{formatQuantity(recipe.lossPercent)}%</Text>
          </View>
        )}
      </View>

      {recipe.generalNotes && <Text style={styles.notesText}>{recipe.generalNotes}</Text>}

      <Text style={styles.sectionHeading}>Состав</Text>
      {recipe.doughWeightKg !== null && (
        <Text style={styles.doughWeightText}>Вес теста на замес: ≈{formatQuantity(recipe.doughWeightKg)} кг</Text>
      )}
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.tableCellHeader, styles.colIngredient]}>Ингредиент</Text>
          <Text style={[styles.tableCellHeader, styles.colQty]}>Количество</Text>
          <Text style={[styles.tableCellHeader, styles.colUnit]}>Ед.</Text>
          {showPercentColumn && <Text style={[styles.tableCellHeader, styles.colPercent]}>% от теста</Text>}
        </View>
        {recipe.items.map((item) => (
          <View style={styles.tableRow} key={item.id}>
            <Text style={[styles.tableCell, styles.colIngredient]}>{item.ingredientProductName}</Text>
            <Text style={[styles.tableCell, styles.colQty]}>{formatQuantity(item.quantity)}</Text>
            <Text style={[styles.tableCell, styles.colUnit]}>{UNIT_LABELS_RU[item.unit]}</Text>
            {showPercentColumn && (
              <Text style={[styles.tableCell, styles.colPercent]}>
                {item.percentOfDoughWeight !== null ? `${item.percentOfDoughWeight.toFixed(1)}%` : "—"}
              </Text>
            )}
          </View>
        ))}
      </View>

      {recipe.stages.length > 0 && (
        <View>
          <Text style={styles.sectionHeading}>Технологический процесс</Text>
          {recipe.stages.map((stage, index) => (
            <View style={styles.stageBlock} key={stage.id} wrap={false}>
              <View style={styles.stageHeader}>
                <Text style={styles.stageNumber}>{index + 1}</Text>
                <Text style={styles.stageName}>{stage.stageTypeName}</Text>
              </View>
              {stage.parameters.length > 0 && <Text style={styles.stageParams}>{formatStageParams(stage)}</Text>}
              {stage.note && <Text style={styles.stageNote}>{stage.note}</Text>}
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionHeading}>Себестоимость</Text>
      <View style={styles.economicsGrid}>
        <View style={styles.economicsCard}>
          <Text style={styles.economicsLabel}>Себестоимость партии</Text>
          <Text style={styles.economicsValue}>{formatMoney(recipe.totalIngredientCost)}</Text>
        </View>
        <View style={styles.economicsCard}>
          <Text style={styles.economicsLabel}>Себестоимость за единицу</Text>
          <Text style={styles.economicsValue}>{formatMoneyPrecise(recipe.unitCost)}</Text>
        </View>
        {showPrice && (
          <View style={styles.economicsCard}>
            <Text style={styles.economicsLabel}>Цена продажи</Text>
            <Text style={styles.economicsValue}>{formatMoney(recipe.productPrice)}</Text>
          </View>
        )}
        {showPrice && recipe.marginPercent !== null && (
          <View style={styles.economicsCard}>
            <Text style={styles.economicsLabel}>Маржа</Text>
            <Text style={styles.economicsValue}>{recipe.marginPercent.toFixed(0)}%</Text>
          </View>
        )}
      </View>

      <View style={styles.footer} fixed>
        <View style={styles.footerBrand}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image is a PDF primitive, not HTML img; it has no alt prop */}
          <Image style={styles.footerLogo} src="/logo.png" />
          <Text style={styles.footerText}>ArAmir OS · Дата печати: {printDate}</Text>
        </View>
        <Text
          style={styles.footerText}
          render={({ pageNumber, totalPages }) => `Стр. ${pageNumber} из ${totalPages}`}
        />
      </View>
    </Page>
  );
}

interface RecipesPdfDocumentProps {
  recipes: RecipeDto[];
  showPrice: boolean;
}

function RecipesPdfDocument({ recipes, showPrice }: RecipesPdfDocumentProps) {
  const printDate = formatDate(new Date());
  return (
    <Document title="Технологические карты" author="ArAmir OS">
      {recipes.map((recipe) => (
        <RecipePage key={recipe.id} recipe={recipe} showPrice={showPrice} printDate={printDate} />
      ))}
    </Document>
  );
}

export async function downloadRecipesPdf(recipes: RecipeDto[], options: { showPrice: boolean }): Promise<void> {
  const blob = await pdf(<RecipesPdfDocument recipes={recipes} showPrice={options.showPrice} />).toBlob();
  const filename =
    recipes.length === 1
      ? `Техкарта — ${recipes[0].productName}.pdf`
      : `Технологические карты (${recipes.length}).pdf`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
