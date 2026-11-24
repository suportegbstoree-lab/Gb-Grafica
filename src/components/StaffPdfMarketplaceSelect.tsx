import {
  isStaffPdfMarketplace,
  STAFF_PDF_MARKETPLACE_LABELS,
  type StaffPdfMarketplace,
} from "../lib/staffPdfMarketplace";

export default function StaffPdfMarketplaceSelect({
  label,
  value,
  pending = false,
  disabled = false,
  onChange,
}: {
  label: string;
  value?: StaffPdfMarketplace;
  pending?: boolean;
  disabled?: boolean;
  onChange: (channel: StaffPdfMarketplace) => void;
}) {
  return (
    <select aria-label={label} value={value ?? ""} disabled={disabled}
      className="max-w-full rounded-lg border border-gray-700 bg-black p-2 text-sm disabled:opacity-50"
      onChange={event => {
        const channel = event.target.value;
        if (isStaffPdfMarketplace(channel)) onChange(channel);
      }}>
      <option value="" disabled>{pending ? "Origem a revisar" : "Sem origem"}</option>
      {Object.entries(STAFF_PDF_MARKETPLACE_LABELS).map(([channel, name]) =>
        <option value={channel} key={channel}>{name}</option>)}
    </select>
  );
}
