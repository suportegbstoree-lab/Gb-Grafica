import { printGeometry, type PrintProfile } from '../lib/printProfile';

export default function PrintGuides({ profile }: { profile: PrintProfile }) {
  const geometry = printGeometry(profile);
  return <div aria-label="Guias de impressão" className="pointer-events-none absolute inset-0 z-20">
    {[['Corte', geometry.trim, 'border-red-500'], ['Área segura', geometry.safe, 'border-emerald-500']].map(([label, box, color]) => {
      const rect = box as typeof geometry.safe;
      return <span key={String(label)} aria-label={String(label)} className={`absolute border border-dashed ${color}`} style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` }} />;
    })}
  </div>;
}
