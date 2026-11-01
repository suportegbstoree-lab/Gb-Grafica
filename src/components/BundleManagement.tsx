import EditorModal from './EditorModal';
import React from 'react';
import type { Anuncio, Category } from '../types';
import { bundleMinimum, type BundleDefinition } from '../lib/bundles';
import { formatMoney } from '../lib/commerce';
import { validateProductDraft } from '../lib/adminValidation';
import { catalogPersistence } from '../services/catalogManagementService';
type Persistence = Pick<typeof catalogPersistence, 'setDocument' | 'deleteDocument'>;
const freshBundle = (): BundleDefinition => ({
  components: [],
  allowQuantity: false,
  discountType: 'none',
  discountValue: 0,
});
export default function BundleManagement({
  products,
  categories,
  persistence = catalogPersistence,
}: {
  products: Anuncio[];
  categories: Category[];
  persistence?: Persistence;
}) {
  const [draft, setDraft] = React.useState<Partial<Anuncio> | null>(null),
    [error, setError] = React.useState(''),
    [message, setMessage] = React.useState(''),
    [busy, setBusy] = React.useState(false);
  const existing = products.filter((p) => p.pacote),
    available = products.filter((p) => !p.pacote),
    bundle = draft?.pacote;
  let total: number | null = null;
  try {
    if (bundle) total = bundleMinimum(bundle, products, draft?.id);
  } catch {}
  const changeBundle = (changes: Partial<BundleDefinition>) =>
    setDraft((current) => (current ? { ...current, pacote: { ...current.pacote!, ...changes } } : current));
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Pacotes de produtos</h2>
          <p className="mt-2 text-sm text-gray-400">
            Composição fixa, escolhas autorizadas e desconto próprio. Promoções dos componentes não se acumulam.
          </p>
        </div>
        <button
          onClick={() => {
            setDraft({
              nome: '',
              desc: '',
              categoria: '',
              imagem: '',
              atributos: [],
              combinacoes: {},
              tipoInput: 'nenhum',
              pacote: freshBundle(),
              tags: [],
            });
            setError('');
            setMessage('');
          }}
          className="rounded-xl bg-pink-500 px-5 py-3 font-bold text-white"
        >
          Criar pacote
        </button>
      </header>
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-green-400">
          {message}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {existing.map((p) => (
          <article key={p.id} className="space-y-3 rounded-2xl border border-gray-800 bg-[#191919] p-5">
            <h3 className="font-bold">{p.nome}</h3>
            <p className="text-sm text-gray-400">{p.pacote!.components.length} componentes</p>
            <button
              className="mr-4 text-sm font-bold text-pink-400"
              onClick={() => {
                setDraft(structuredClone(p));
                setError('');
                setMessage('');
              }}
            >
              Editar {p.nome}
            </button>
            <button
              disabled={busy}
              className="text-sm text-red-400"
              onClick={() => {
                if (!window.confirm(`Excluir o pacote “${p.nome}”? Os pedidos anteriores serão preservados.`)) return;
                setBusy(true);
                void persistence
                  .deleteDocument('anuncios', p.id)
                  .then(() => setMessage('Pacote excluído.'))
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Excluir pacote
            </button>
          </article>
        ))}
      </div>
      {draft && bundle && (
        <EditorModal
          title={draft.id ? 'Editar pacote' : 'Novo pacote'}
          onClose={() => setDraft(null)}
          busy={busy}
          footerText="Salve o pacote antes de sair para publicar as alterações."
          closeLabel="Fechar editor de pacote"
          doneLabel="Voltar à lista"
        >
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              const value = {
                ...draft,
                id: draft.id || crypto.randomUUID().replaceAll('-', ''),
                pacote: bundle,
                tags: (draft.tags || []).map((t) => t.trim()).filter(Boolean),
              } as Anuncio;
              const result = validateProductDraft(value, categories, products);
              if (!result.ok) {
                setError((result as any).message);
                return;
              }
              setBusy(true);
              setError('');
              void persistence
                .setDocument('anuncios', value.id, { ...value, ...result.value })
                .then(() => {
                  setDraft(null);
                  setMessage('Pacote salvo.');
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {error && (
              <p role="alert" className="text-red-400">
                {error}
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {(['nome', 'desc', 'imagem'] as const).map((key) => (
                <label key={key} className="text-sm">
                  {key === 'nome' ? 'Nome do pacote' : key === 'desc' ? 'Descrição' : 'URL da imagem de apresentação'}
                  <input
                    required
                    maxLength={key === 'nome' ? 199 : key === 'desc' ? 999 : 2048}
                    value={draft[key] || ''}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    className="mt-2 w-full rounded-lg border border-gray-700 bg-black p-3"
                  />
                </label>
              ))}
              <label className="text-sm">
                Categoria
                <select
                  aria-label="Categoria"
                  required
                  value={draft.categoria || ''}
                  onChange={(e) => setDraft({ ...draft, categoria: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-gray-700 bg-black p-3"
                >
                  <option value="">Selecionar</option>
                  {categories.map((c) => (
                    <option key={c.id}>{c.nome}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Tags (separadas por vírgula)
                <input
                  value={(draft.tags || []).join(',')}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',') })}
                  className="mt-2 w-full rounded-lg border border-gray-700 bg-black p-3"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-5">
              {(['destaque', 'lancamento'] as const).map((key) => (
                <label key={key} className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft[key] === true}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
                  />
                  {key === 'destaque' ? 'Adicionar a destaque' : 'Marcar como lançamento'}
                </label>
              ))}
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bundle.allowQuantity}
                  onChange={(e) => changeBundle({ allowQuantity: e.target.checked })}
                />
                Cliente pode alterar a quantidade de pacotes
              </label>
            </div>
            <label className="block text-sm">
              Usar imagem de um componente
              <select
                aria-label="Usar imagem de um componente"
                value=""
                onChange={(e) => {
                  const selected = available.find((p) => p.id === e.target.value);
                  if (selected) setDraft({ ...draft, imagem: selected.imagem });
                }}
                className="mt-2 w-full rounded-lg border border-gray-700 bg-black p-3"
              >
                <option value="">Selecione uma imagem existente</option>
                {available
                  .filter((p) => bundle.components.some((c) => c.productId === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
              </select>
            </label>
            <h4 className="font-bold">Componentes do pacote</h4>
            {bundle.components.map((c, index) => {
              const p = available.find((p) => p.id === c.productId);
              return (
                <fieldset key={c.productId} className="space-y-4 rounded-xl border border-gray-700 p-4">
                  <legend className="px-2 font-bold">{p?.nome || 'Produto removido'}</legend>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="text-sm">
                      Quantidade inicial
                      <input
                        aria-label={`Quantidade inicial de ${p?.nome}`}
                        type="number"
                        min="1"
                        max="20"
                        value={c.quantity}
                        onChange={(e) =>
                          changeBundle({
                            components: bundle.components.map((v, i) =>
                              i === index ? { ...v, quantity: Number(e.target.value) } : v,
                            ),
                          })
                        }
                        className="ml-2 w-20 rounded border border-gray-700 bg-black p-2"
                      />
                    </label>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={c.allowQuantity}
                        onChange={(e) =>
                          changeBundle({
                            components: bundle.components.map((v, i) =>
                              i === index ? { ...v, allowQuantity: e.target.checked } : v,
                            ),
                          })
                        }
                      />
                      Cliente pode alterar essa quantidade
                    </label>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={c.configurable}
                        onChange={(e) =>
                          changeBundle({
                            components: bundle.components.map((v, i) =>
                              i === index ? { ...v, configurable: e.target.checked } : v,
                            ),
                          })
                        }
                      />
                      Cliente escolhe as opções
                    </label>
                    <button
                      type="button"
                      className="text-sm text-red-400"
                      onClick={() => changeBundle({ components: bundle.components.filter((_, i) => i !== index) })}
                    >
                      Remover componente
                    </button>
                  </div>
                  {!c.configurable &&
                    p?.atributos.map((a) => (
                      <label key={a.nome} className="block text-sm">
                        {a.nome}
                        <select
                          aria-label={a.nome}
                          required
                          value={c.selections[a.nome] || ''}
                          onChange={(e) =>
                            changeBundle({
                              components: bundle.components.map((v, i) =>
                                i === index ? { ...v, selections: { ...v.selections, [a.nome]: e.target.value } } : v,
                              ),
                            })
                          }
                          className="ml-3 rounded border border-gray-700 bg-black p-2"
                        >
                          <option value="">Selecionar opção fixa</option>
                          {a.opcoes.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                </fieldset>
              );
            })}
            <label className="block text-sm">
              Adicionar produto
              <select
                aria-label="Adicionar produto ao pacote"
                value=""
                disabled={bundle.components.length >= 10}
                onChange={(e) => {
                  if (e.target.value)
                    changeBundle({
                      components: [
                        ...bundle.components,
                        {
                          productId: e.target.value,
                          quantity: 1,
                          allowQuantity: false,
                          configurable: false,
                          selections: {},
                        },
                      ],
                    });
                }}
                className="mt-2 w-full rounded-lg border border-gray-700 bg-black p-3"
              >
                <option value="">Selecione até 10 produtos</option>
                {available
                  .filter((p) => !bundle.components.some((c) => c.productId === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                Desconto do pacote
                <select
                  aria-label="Desconto do pacote"
                  value={bundle.discountType}
                  onChange={(e) => changeBundle({ discountType: e.target.value as any, discountValue: 0 })}
                  className="mt-2 w-full rounded-lg border border-gray-700 bg-black p-3"
                >
                  <option value="none">Sem desconto</option>
                  <option value="percent">Percentual (%)</option>
                  <option value="fixed">Valor fixo (R$)</option>
                </select>
              </label>
              {bundle.discountType !== 'none' && (
                <label className="text-sm">
                  {bundle.discountType === 'percent' ? 'Percentual' : 'Valor do desconto em R$'}
                  <input
                    type="number"
                    min="0"
                    step={bundle.discountType === 'fixed' ? '0.01' : '1'}
                    value={bundle.discountValue / (bundle.discountType === 'fixed' ? 100 : 1)}
                    onChange={(e) =>
                      changeBundle({
                        discountValue: Math.round(Number(e.target.value) * (bundle.discountType === 'fixed' ? 100 : 1)),
                      })
                    }
                    className="mt-2 w-full rounded-lg border border-gray-700 bg-black p-3"
                  />
                </label>
              )}
            </div>
            <p className="font-bold">
              Preço {bundle.components.some((c) => c.configurable || c.allowQuantity) ? 'a partir de' : ''}:{' '}
              {total === null ? 'Revise os componentes e o desconto' : formatMoney(total / 100)}
            </p>
            <p className="text-xs text-gray-400">
              O preço acompanha o catálogo. Alterações de composição ou desconto exigem que o cliente configure o pacote
              novamente.
            </p>
            <button
              disabled={busy}
              className="w-full rounded-xl bg-pink-500 p-4 font-bold text-white disabled:opacity-50"
            >
              {busy ? 'Salvando...' : 'Salvar pacote'}
            </button>
          </form>
        </EditorModal>
      )}
    </section>
  );
}
