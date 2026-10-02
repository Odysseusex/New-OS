// A category as a person reads it: «Бакалея › Мука пшеничная» for a
// subcategory, just the name for a top-level one. Include the parent when
// loading (`categoryRef: { include: { parent: true } }`), or the label falls
// back to the bare name.
export type CategoryWithParent = { name: string; parent?: { name: string } | null };

export const CATEGORY_WITH_PARENT = { include: { parent: true } } as const;

export function categoryLabel(ref: CategoryWithParent | null | undefined): string | null {
  if (!ref) return null;
  return ref.parent ? `${ref.parent.name} › ${ref.name}` : ref.name;
}
