import React, { forwardRef, useRef, useState } from "react";
import { createPortal } from "react-dom";
type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  originalPdf?: boolean;
  maxFiles?: number;
  showDropHint?: boolean;
};
/** Batch slots accept every file. Single slots require an explicit choice from a batch. */
export default forwardRef<HTMLInputElement, Props>(function UploadInput(
  { multiple, onChange, originalPdf = false, maxFiles = 50, showDropHint = true, ...props },
  forwarded,
) {
  const input = useRef<HTMLInputElement>(null),
    [choices, setChoices] = useState<File[]>([]),
    [error, setError] = useState("");
  const emit = (files: File[]) => {
    const node = input.current;
    if (!node) return;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    node.files = transfer.files;
    onChange?.({
      target: node,
      currentTarget: node,
    } as React.ChangeEvent<HTMLInputElement>);
  };
  const receive = async (files: File[]) => {
    if (props.disabled || !files.length) return;
    const limit = Math.max(1, Math.min(500, Math.floor(maxFiles)));
    if (files.length > limit) {
      setError(`Selecione até ${limit} arquivos por envio.`);
      return;
    }
    setError("");
    try {
      const normalized: File[] = [];
      for (const file of files) {
        if (!originalPdf && file.type === "application/pdf")
          normalized.push(
            ...(await (
              await import("../services/pdfPreview")
            ).pdfPreviewPages(file)),
          );
        else normalized.push(file);
      }
      if (!multiple && normalized.length > 1) setChoices(normalized);
      else emit(normalized);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível preparar o envio.",
      );
    }
  };
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  React.useEffect(() => {
    const target =
      input.current?.closest("label") ||
      (input.current?.id
        ? document.querySelector(`label[for="${CSS.escape(input.current.id)}"]`)
        : null) ||
      input.current?.parentElement;
    if (!target) return;
    const over = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer)
        void receiveRef.current([...event.dataTransfer.files]);
    };
    target.addEventListener("dragover", over);
    target.addEventListener("drop", drop);
    return () => {
      target.removeEventListener("dragover", over);
      target.removeEventListener("drop", drop);
    };
  }, []);
  return (
    <>
      <span className="contents">
        <input
          {...props}
          type="file"
          multiple
          ref={(node) => {
            input.current = node;
            if (typeof forwarded === "function") forwarded(node);
            else if (forwarded) forwarded.current = node;
          }}
          onChange={(e) => {
            const files = [...(e.target.files || [])];
            e.target.value = "";
            void receive(files);
          }}
        />
        {showDropHint && <span className="ml-2 text-[10px] font-normal">
          ou arraste arquivos aqui
        </span>}
      </span>
      {error && (
        <span role="alert" className="block text-xs text-red-500">
          {error}
        </span>
      )}
      {choices.length > 0 &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Escolher arquivo do lote"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setChoices([]);
                input.current?.focus();
              }
            }}
            className="admin-controls fixed inset-0 z-[200] grid place-items-center bg-black/70 p-4"
          >
            <div className="max-h-[80vh] w-full max-w-lg space-y-3 overflow-auto rounded-xl bg-gray-900 p-6 text-white">
              <h3 className="font-bold">Escolha o arquivo para este campo</h3>
              <p className="text-sm">Este campo exibe um arquivo por vez.</p>
              {choices.map((file, i) => (
                <button
                  autoFocus={i === 0}
                  type="button"
                  key={i}
                  className="block w-full break-words rounded border border-gray-600 p-3 text-left"
                  onClick={() => {
                    setChoices([]);
                    emit([file]);
                  }}
                >
                  {file.name}
                </button>
              ))}
              <button type="button" onClick={() => setChoices([])}>
                Cancelar
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
});
