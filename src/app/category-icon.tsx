import { categoryAppearance, type CategoryKind } from "@/lib/category-icons";

export function CategoryIcon({ name, kind }: { name: string; kind: CategoryKind }) {
  const { icon: Icon, color, background } = categoryAppearance(name, kind);
  return <span className="category-icon" style={{ color, background }} aria-hidden="true"><Icon size={19} strokeWidth={1.9} /></span>;
}
