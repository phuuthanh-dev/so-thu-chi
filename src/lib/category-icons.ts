import {
  Baby, BriefcaseBusiness, CarFront, CircleEllipsis, Coffee, Droplets, Gift,
  GraduationCap, HandCoins, HeartPulse, House, Lightbulb, Plane, ShoppingBag,
  Sparkles, Tag, Ticket, TrendingUp, UtensilsCrossed, Wifi, type LucideIcon,
} from "lucide-react";

export type CategoryKind = "income" | "expense";
type CategoryAppearance = { icon: LucideIcon; color: string; background: string };
type CategoryRule = CategoryAppearance & { match: RegExp; kind?: CategoryKind };

// Normalization keeps matching consistent for accented and unaccented Vietnamese.
const normalize = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const rules: CategoryRule[] = [
  { match: /\b(ca phe|cafe|tra sua|do uong)\b/, icon: Coffee, color: "#95603b", background: "#fff0df" },
  { match: /\b(an uong|an sang|an trua|an toi|nha hang|thuc an|thuc pham|di cho|tien cho)\b/, icon: UtensilsCrossed, color: "#b34f36", background: "#fff0e9" },
  { match: /\b(my pham|lam dep|cham soc da|spa)\b/, icon: Sparkles, color: "#ad4b76", background: "#fdeaf3" },
  { match: /\b(mua sam|quan ao|thoi trang|mua do|sieu thi)\b/, icon: ShoppingBag, color: "#a44270", background: "#fbeaf2" },
  { match: /\b(du lich|may bay|nghi duong|ve may bay)\b/, icon: Plane, color: "#386ca2", background: "#e9f2fb" },
  { match: /\b(di lai|xang xe|taxi|gui xe|o to|xe may|phuong tien|van chuyen)\b/, icon: CarFront, color: "#326c96", background: "#e9f4fa" },
  { match: /\b(tien dien|dien sinh hoat|hoa don dien)\b/, icon: Lightbulb, color: "#98691b", background: "#fff3d6" },
  { match: /\b(tien nuoc|nuoc sinh hoat|hoa don nuoc)\b/, icon: Droplets, color: "#267e9b", background: "#e5f6fa" },
  { match: /\b(internet|wifi|mang|dien thoai|lien lac)\b/, icon: Wifi, color: "#5269a5", background: "#edf1fd" },
  { match: /\b(nha cua|tien nha|thue nha|nha o|sinh hoat)\b/, icon: House, color: "#91612d", background: "#fff2df" },
  { match: /\b(suc khoe|y te|benh vien|kham benh|thuoc|nha khoa)\b/, icon: HeartPulse, color: "#b1405a", background: "#ffedf0" },
  { match: /\b(giao duc|hoc phi|truong hoc|khoa hoc|sach vo)\b/, icon: GraduationCap, color: "#4a68a2", background: "#edf2ff" },
  { match: /\b(con cai|em be|cho con|tre em)\b/, icon: Baby, color: "#b26046", background: "#fff0e9" },
  { match: /\b(giai tri|xem phim|am nhac|ve xem phim)\b/, icon: Ticket, color: "#7655a3", background: "#f3edfc" },
  { match: /\b(qua tang|tang qua|mung tuoi|tien thuong|phan thuong|thuong tet)\b|^thuong$/, icon: Gift, color: "#ad4a62", background: "#ffedf1" },
  { match: /\b(dau tu|co tuc|lai suat|chung khoan)\b/, icon: TrendingUp, color: "#2f7d70", background: "#e5f6f1" },
  { match: /\b(luong|tien cong|phu cap)\b/, kind: "income", icon: BriefcaseBusiness, color: "#337857", background: "#eaf6ed" },
  { match: /\b(thu nhap|thu lao|ban hang)\b/, kind: "income", icon: HandCoins, color: "#277e70", background: "#e6f6f3" },
  { match: /^khac$/, icon: CircleEllipsis, color: "#80627f", background: "#f5edf5" },
];
const fallback: CategoryAppearance[] = [
  { icon: Tag, color: "#a6496f", background: "#faeaf1" },
  { icon: Tag, color: "#356f98", background: "#eaf3fa" },
  { icon: Tag, color: "#94702c", background: "#fff5de" },
  { icon: Tag, color: "#4d7e60", background: "#edf7ed" },
  { icon: Tag, color: "#7959a0", background: "#f2edfa" },
  { icon: Tag, color: "#b15c3f", background: "#fff0e7" },
];

export function categoryAppearance(name: string, kind: CategoryKind): CategoryAppearance {
  const normalized = normalize(name);
  const rule = rules.find((item) => (!item.kind || item.kind === kind) && item.match.test(normalized));
  if (rule) return rule;
  let hash = 0;
  for (const char of `${kind}:${normalized}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return fallback[hash % fallback.length];
}

export type CategoryAppearanceRecord = {
  kind: CategoryKind;
  category: string;
  icon_key: string | null;
  color_key: string | null;
  revision: number;
};
export const categoryIconChoices = [
  { key: "food", label: "Ăn uống", icon: UtensilsCrossed },
  { key: "coffee", label: "Cà phê", icon: Coffee },
  { key: "shopping", label: "Mua sắm", icon: ShoppingBag },
  { key: "travel", label: "Du lịch", icon: Plane },
  { key: "transport", label: "Đi lại", icon: CarFront },
  { key: "home", label: "Nhà cửa", icon: House },
  { key: "health", label: "Sức khỏe", icon: HeartPulse },
  { key: "education", label: "Giáo dục", icon: GraduationCap },
  { key: "children", label: "Trẻ em", icon: Baby },
  { key: "entertainment", label: "Giải trí", icon: Ticket },
  { key: "gift", label: "Quà tặng", icon: Gift },
  { key: "beauty", label: "Làm đẹp", icon: Sparkles },
  { key: "salary", label: "Công việc", icon: BriefcaseBusiness },
  { key: "income", label: "Thu nhập", icon: HandCoins },
  { key: "investment", label: "Đầu tư", icon: TrendingUp },
  { key: "electricity", label: "Điện", icon: Lightbulb },
  { key: "water", label: "Nước", icon: Droplets },
  { key: "internet", label: "Internet", icon: Wifi },
  { key: "tag", label: "Nhãn", icon: Tag },
  { key: "other", label: "Khác", icon: CircleEllipsis },
] as const;
export const categoryColorChoices = [
  { key: "rose", label: "Hồng", color: "#a44270", background: "#fbeaf2" },
  { key: "red", label: "Đỏ", color: "#b1405a", background: "#ffedf0" },
  { key: "orange", label: "Cam", color: "#b34f36", background: "#fff0e9" },
  { key: "amber", label: "Vàng", color: "#98691b", background: "#fff3d6" },
  { key: "brown", label: "Nâu", color: "#91612d", background: "#fff2df" },
  { key: "green", label: "Xanh lá", color: "#337857", background: "#eaf6ed" },
  { key: "teal", label: "Xanh ngọc", color: "#277e70", background: "#e6f6f3" },
  { key: "cyan", label: "Xanh biển nhạt", color: "#267e9b", background: "#e5f6fa" },
  { key: "blue", label: "Xanh dương", color: "#326c96", background: "#e9f4fa" },
  { key: "indigo", label: "Xanh chàm", color: "#4a68a2", background: "#edf2ff" },
  { key: "purple", label: "Tím", color: "#7655a3", background: "#f3edfc" },
  { key: "mauve", label: "Tím xám", color: "#80627f", background: "#f5edf5" },
] as const;

export function customizedCategoryAppearance(name: string, kind: CategoryKind, choice?: Pick<CategoryAppearanceRecord, "icon_key" | "color_key"> | null): CategoryAppearance {
  const automatic = categoryAppearance(name, kind);
  const icon = categoryIconChoices.find((item) => item.key === choice?.icon_key)?.icon || automatic.icon;
  const color = categoryColorChoices.find((item) => item.key === choice?.color_key);
  return { icon, color: color?.color || automatic.color, background: color?.background || automatic.background };
}
