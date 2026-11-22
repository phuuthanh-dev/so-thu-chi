import { CalendarDays } from "lucide-react";

type DateInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
};

export function DateInput({ label, value, onChange, required, disabled }: DateInputProps) {
  return (
    <span className="form-date-control">
      <span className="form-date-text" aria-hidden="true">{value ? value.split("-").reverse().join("/") : "Chọn ngày"}</span>
      <CalendarDays size={17} aria-hidden="true" />
      <input aria-label={label} type="date" value={value} required={required} disabled={disabled} onChange={event => onChange(event.target.value)} />
    </span>
  );
}
