import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

export function Dropzone({ onFiles, compact, multiple = true }: { onFiles: (f: File[]) => void; compact?: boolean; multiple?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      role="button" tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}
      className={`rounded-[var(--radius-panel)] border-2 border-dashed cursor-pointer transition-colors flex items-center justify-center text-center gap-3
        ${compact ? "px-4 py-3 flex-row" : "px-6 py-8 flex-col"} ${over ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent"}`}
    >
      <UploadCloud size={compact ? 18 : 26} className="text-accent shrink-0" />
      <div className="text-sm">
        <span className="font-medium">Arraste arquivos</span> ou clique para selecionar
        {!compact && <p className="text-[12px] text-muted mt-1">PDF, imagens (TIFF, PNG, JPG), Office e CAD nativo. OCR automático em PDF escaneado e imagem.</p>}
      </div>
      <input ref={input} type="file" multiple={multiple} hidden onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </div>
  );
}
