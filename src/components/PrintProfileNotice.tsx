import { printGeometry, printImageQuality, printProfileLabel, type PrintProfile } from '../lib/printProfile';

export default function PrintProfileNotice({ profile, width, height }: { profile: PrintProfile; width: number; height: number }) {
  const quality = printImageQuality(profile, width, height);
  const geometry = printGeometry(profile);
  return <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700" aria-label="Conferência de impressão">
    <p className="font-bold">{printProfileLabel(profile)}</p>
    <p>Arte com sangria: {geometry.widthMm} × {geometry.heightMm} mm. Recomendação: {quality.recommendedWidth} × {quality.recommendedHeight} px ({profile.targetDpi} dpi).</p>
    {width > 0 && height > 0 && <>
      <p>{width} × {height} px · resolução efetiva: {Math.round(quality.dpi)} dpi.</p>
      {!quality.ratioMatches && <p role="alert" className="font-bold text-red-700">A proporção da imagem difere do formato com sangria. Ajuste a arte para gerar o modelo; a imagem não será cortada ou esticada automaticamente.</p>}
      {quality.belowTarget && <p role="status" className="font-bold text-amber-800">Resolução abaixo da recomendada. A impressão pode perder nitidez; a exportação preserva os pixels recebidos.</p>}
    </>}
  </div>;
}
