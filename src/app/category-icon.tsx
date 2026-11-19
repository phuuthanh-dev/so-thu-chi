import { customizedCategoryAppearance, type CategoryAppearanceRecord, type CategoryKind } from "@/lib/category-icons";

export function CategoryIcon({ name, kind, choice }: { name: string; kind: CategoryKind; choice?: Pick<CategoryAppearanceRecord, "icon_key" | "color_key"> | null }) {
  const { icon: Icon, color, background } = customizedCategoryAppearance(name, kind, choice);
  return <span className="category-icon" style={{ color, background }} aria-hidden="true"><Icon size={19} strokeWidth={1.9} /></span>;
}
