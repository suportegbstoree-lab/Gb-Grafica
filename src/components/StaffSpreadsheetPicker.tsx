import { Upload } from "lucide-react";
import UploadInput from "./UploadInput";

export default function StaffSpreadsheetPicker({ format, disabled, onFile }: {
  format: "CSV" | "XLSX";
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-gray-700 px-4 py-3 text-sm has-[:disabled]:opacity-50">
      <Upload size={16} aria-hidden="true" />
      <span className="font-medium">Selecionar arquivo {format}</span>
      <span className="text-xs text-gray-400">ou arraste aqui</span>
      <UploadInput
        aria-label={`Arquivo ${format}`}
        className="sr-only"
        accept={format === "CSV" ? ".csv,text/csv" : ".xlsx"}
        disabled={disabled}
        originalPdf
        showDropHint={false}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}
