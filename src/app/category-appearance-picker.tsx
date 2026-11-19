import { categoryColorChoices, categoryIconChoices, type CategoryKind } from "@/lib/category-icons";
import { CategoryIcon } from "./category-icon";

export function CategoryAppearancePicker({ name, kind, icon, color, onIcon, onColor }: {
  name: string; kind: CategoryKind; icon: string | null; color: string | null;
  onIcon: (value: string | null) => void; onColor: (value: string | null) => void;
}) {
  const iconLabel = categoryIconChoices.find(item => item.key === icon)?.label || "Tự động";
  const colorLabel = categoryColorChoices.find(item => item.key === color)?.label || "Tự động";
  return <div className="appearance-picker">
    <div className="appearance-preview"><CategoryIcon name={name} kind={kind} choice={{icon_key:icon,color_key:color}} /><div><strong>Xem trước</strong><span>{name}</span><small>Icon: {iconLabel}</small><small>Màu: {colorLabel}</small></div></div>
    <fieldset><legend>Icon</legend><div className="appearance-icon-grid">
      <button type="button" className="appearance-auto" aria-label="Icon tự động" aria-pressed={icon === null} onClick={() => onIcon(null)}>Tự động</button>
      {categoryIconChoices.map(({key,label,icon: Icon}) => <button type="button" key={key} aria-label={`Icon ${label}`} title={label} aria-pressed={icon === key} onClick={() => onIcon(key)}><Icon size={20} aria-hidden="true" /></button>)}
    </div></fieldset>
    <fieldset><legend>Màu sắc</legend><div className="appearance-color-grid">
      <button type="button" className="appearance-auto" aria-label="Màu tự động" aria-pressed={color === null} onClick={() => onColor(null)}>Tự động</button>
      {categoryColorChoices.map(item => <button type="button" key={item.key} aria-label={`Màu ${item.label}`} title={item.label} aria-pressed={color === item.key} onClick={() => onColor(item.key)}><span aria-hidden="true" style={{background:item.color}} /></button>)}
    </div></fieldset>
  </div>;
}
