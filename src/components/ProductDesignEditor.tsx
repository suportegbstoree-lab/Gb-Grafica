import React from 'react';
import type { Anuncio } from '../types';
import type { AdminCatalogImageStorage } from '../pages/Admin';
import { canEditProductImages, canEditProductPersonalization, type StaffPermission } from '../lib/staffAccess';
import EditorModal from './EditorModal';
import ProductPrintEditor from './ProductPrintEditor';

export default function ProductDesignEditor({ product, permissions, storage, onSave, onClose }: {
  product: Anuncio; permissions: StaffPermission[]; storage: AdminCatalogImageStorage;
  onSave: (draft: Anuncio) => Promise<Anuncio>; onClose: () => void;
}) {
  const [draft, setDraft] = React.useState(() => structuredClone(product));
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const uploaded = React.useRef(new Map<string, string>()), saved = React.useRef(false), savedUrls = React.useRef(new Set<string>());
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => {
    alive.current = false;
    for (const [path, url] of uploaded.current) if (!saved.current || !savedUrls.current.has(url)) void storage.deleteImage(path).catch(() => undefined);
  }; }, [storage]);
  const images = canEditProductImages(permissions), personalization = canEditProductPersonalization(permissions);
  const upload = async (event: React.ChangeEvent<HTMLInputElement>, gallery: boolean) => {
    const files = [...(event.target.files || [])]; event.target.value = '';
    if (!files.length || busy) return;
    if (gallery && (draft.imagens?.length || 0) + files.length > 50) { setError('A galeria aceita até 50 imagens.'); return; }
    setBusy(true); setError('');
    const additions: Array<{ path: string; url: string }> = [];
    try {
      for (const file of gallery ? files : files.slice(0, 1)) {
        const result = await storage.uploadImage(product.id, file); additions.push(result); uploaded.current.set(result.path, result.url);
      }
      if (!alive.current) { await Promise.allSettled(additions.map(file => storage.deleteImage(file.path))); return; }
      setDraft(current => gallery ? { ...current, imagens: [...(current.imagens || []), ...additions.map(file => file.url)] } : { ...current, imagem: additions[0].url });
    } catch (reason) {
      await Promise.allSettled(additions.map(file => storage.deleteImage(file.path)));
      for (const file of additions) uploaded.current.delete(file.path);
      if (alive.current) setError(reason instanceof Error ? reason.message : 'Não foi possível enviar a imagem.');
    } finally { if (alive.current) setBusy(false); }
  };
  const save = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const stored = await onSave(draft); saved.current = true; savedUrls.current = new Set([stored.imagem, ...(stored.imagens || [])]);
      if (alive.current) onClose();
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <EditorModal title="Editar arte do produto" busy={busy} onClose={onClose} closeLabel="Fechar edição da arte" doneLabel="Cancelar" footerText="As alterações ficam limitadas às permissões da sua função.">
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-6">
      <header><h3 className="text-lg font-bold">{product.nome}</h3><p className="mt-1 text-xs text-gray-400">{product.categoria}</p></header>
      {images && <fieldset disabled={busy} className="space-y-4 rounded-xl border border-gray-800 p-4">
        <legend className="px-2 text-sm font-bold">Imagens do produto</legend>
        <label className="block text-xs text-gray-400">Imagem principal (URL)<input type="text" value={draft.imagem} onChange={event => setDraft(current => ({ ...current, imagem: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-700 bg-black px-3 py-2" /></label>
        <img src={draft.imagem} alt="Prévia da imagem principal" className="h-36 w-full rounded-lg object-contain" />
        <label className="inline-flex cursor-pointer rounded-lg bg-pink-500 px-4 py-3 text-xs font-bold">Enviar imagem principal<input type="file" aria-label="Enviar imagem principal" accept="image/png,image/jpeg,image/webp" onChange={event => void upload(event, false)} className="sr-only" /></label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(draft.imagens || []).map((url, index) => <div key={`${url}-${index}`} className="space-y-2"><img src={url} alt={`Imagem ${index + 1} da galeria`} className="h-24 w-full rounded-lg object-cover" /><button type="button" onClick={() => setDraft(current => ({ ...current, imagens: current.imagens?.filter((_, i) => i !== index) }))} aria-label={`Remover imagem ${index + 1} da galeria`} className="text-xs text-red-400">Remover</button></div>)}</div>
        <label className="inline-flex cursor-pointer rounded-lg border border-gray-700 px-4 py-3 text-xs font-bold">Adicionar imagens à galeria<input type="file" aria-label="Adicionar imagens à galeria" multiple accept="image/png,image/jpeg,image/webp" onChange={event => void upload(event, true)} className="sr-only" /></label>
      </fieldset>}
      {personalization && <fieldset disabled={busy} className="space-y-4">
        <label className="block text-xs text-gray-400">Tipo de personalização<select aria-label="Tipo de personalização" value={draft.tipoInput || 'nenhum'} onChange={event => setDraft(current => ({ ...current, tipoInput: event.target.value as Anuncio['tipoInput'] }))} className="mt-2 w-full rounded-lg border border-gray-700 bg-black px-3 py-2"><option value="nenhum">Nenhuma</option><option value="arte">Upload de arte</option><option value="texto">Texto</option><option value="texto_arte">Texto e imagem</option></select></label>
        {(draft.tipoInput === 'texto' || draft.tipoInput === 'texto_arte') && <label className="block text-xs text-gray-400">Rótulo do texto<input maxLength={160} required value={draft.labelTexto || ''} onChange={event => setDraft(current => ({ ...current, labelTexto: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-700 bg-black px-3 py-2" /></label>}
        <ProductPrintEditor product={draft} onChange={value => setDraft(value as Anuncio)} />
      </fieldset>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-lg bg-pink-500 px-6 py-3 text-sm font-bold disabled:opacity-40">{busy ? 'Salvando...' : 'Salvar arte do produto'}</button>
    </form>
  </EditorModal>;
}
