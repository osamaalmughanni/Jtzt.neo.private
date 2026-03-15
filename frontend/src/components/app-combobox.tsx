import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

interface AppComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  items: ComboboxOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

export function AppCombobox({
  value,
  onValueChange,
  items,
  placeholder,
  emptyText,
  disabled,
  className,
}: AppComboboxProps) {
  return (
    <Combobox
      value={value}
      onValueChange={onValueChange}
      options={items}
      placeholder={placeholder}
      emptyText={emptyText}
      disabled={disabled}
      className={className}
      searchable={false}
    />
  );
}
