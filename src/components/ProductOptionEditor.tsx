import React, { useEffect, useState } from "react";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import {
  ADMIN_LIMITS,
  generateProductCombinations,
} from "../lib/adminValidation";
import { formatMoney, parseMoneyToCents } from "../lib/commerce";
import {
  productPrice,
  type ProductProductionAssets,
} from "../lib/productCustomization";
import {
  MAX_COMBINATION_SKU,
  MAX_VARIATION_SKU,
  productSku,
  replaceProductOption,
  variationTypeName,
  type VariationType,
} from "../lib/productSales";
import type { Anuncio, ProductAttribute } from "../types";
import type { SalesAdminApi } from "../services/salesService";
import UploadInput from "./UploadInput";
import ProductProductionEditor, {
  type ProductProductionEditorProps,
} from "./ProductProductionEditor";

type ProductionEditorSettings = Omit<
  ProductProductionEditorProps,
  "product" | "onChange" | "optionLabel"
>;

const field =
  "min-w-0 w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm";
const button =
  "inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm hover:border-pink-500 disabled:opacity-40";

type Option = NonNullable<ProductAttribute["configuracao"]>[string];

function OptionControls({
  attribute,
  option,
  config,
  onRename,
  onRemove,
  onConfig,
  onUpload,
  additive,
  productionEditor,
}: {
  key?: string;
  attribute: ProductAttribute;
  option: string;
  config: Option;
  additive: boolean;
  productionEditor: React.ReactNode;
  onRename: (value: string) => boolean;
  onRemove: () => void;
  onConfig: (patch: Partial<Option>) => void;
  onUpload: (file: File) => void;
}) {
  const label = `${attribute.nome}: ${option}`;
  return (
    <div className="space-y-3 rounded-xl border border-gray-800 bg-[#151515] p-3">
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1 text-xs text-gray-400">
          Nome da opção
          <input
            className={field + " mt-1"}
            aria-label={`Opção ${label}`}
            defaultValue={option}
            maxLength={80}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            onBlur={(event) => {
              if (!onRename(event.target.value)) event.target.value = option;
            }}
          />
        </label>
        <button
          type="button"
          className="rounded p-2 text-red-300"
          aria-label={`Remover opção ${label}`}
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {config.referencia && (
          <img
            src={config.referencia}
            alt={`Referência ${label}`}
            className="h-12 w-12 rounded border border-gray-700 object-cover"
          />
        )}
        <label className={button}>
          <ImagePlus size={15} />{" "}
          {config.referencia ? "Trocar referência" : "Imagem de referência"}
          <UploadInput
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label={`Enviar referência ${label}`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUpload(file);
            }}
          />
        </label>
        {config.referencia && (
          <button
            type="button"
            className="text-xs text-red-300"
            onClick={() => onConfig({ referencia: undefined })}
          >
            Remover imagem
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">
          SKU da opção
          <input
            className={field + " mt-1"}
            aria-label={`SKU da opção ${label}`}
            maxLength={MAX_VARIATION_SKU}
            value={config.sku ?? ""}
            placeholder={option}
            onChange={(event) => onConfig({ sku: event.target.value })}
          />
        </label>
        {additive && (
          <label className="text-xs text-gray-400">
            Adicional em reais
            <input
              className={field + " mt-1"}
              aria-label={`Adicional ${label}`}
              inputMode="decimal"
              value={config.adicional ?? ""}
              placeholder="0,00"
              onChange={(event) =>
                onConfig({ adicional: event.target.value || undefined })
              }
            />
          </label>
        )}
        {(["texto", "imagem"] as const).map((key) => (
          <label key={key} className="text-xs text-gray-400">
            {key === "texto" ? "Nome personalizado" : "Imagem personalizada"}
            <select
              className={field + " mt-1"}
              aria-label={`${key} ${label}`}
              value={config[key] === undefined ? "" : String(config[key])}
              onChange={(event) =>
                onConfig({
                  [key]:
                    event.target.value === ""
                      ? undefined
                      : event.target.value === "true",
                })
              }
            >
              <option value="">Do produto</option>
              <option value="true">Habilitado</option>
              <option value="false">Desabilitado</option>
            </select>
          </label>
        ))}
      </div>
      <details className="rounded-lg border border-gray-700 p-2 text-xs">
        <summary className="cursor-pointer">
          Arte de produção da opção
          <span className="ml-2 text-gray-400">
            {config.moldePdf
              ? config.moldePdf.pdf.name
              : config.imagemBase
                ? "Imagem-base própria"
                : "Usar arte do produto"}
          </span>
        </summary>
        <div className="mt-3">{productionEditor}</div>
      </details>
    </div>
  );
}

function VariationGroup({
  attribute,
  index,
  types,
  used,
  product,
  onChange,
  onUpload,
  onError,
  production,
  onProductionChange,
}: {
  key?: string;
  attribute: ProductAttribute;
  index: number;
  types: VariationType[];
  used: ProductAttribute[];
  product: Partial<Anuncio>;
  onChange: (value: Partial<Anuncio>) => void;
  onUpload: (attribute: string, option: string, file: File) => void;
  onError: (error: string) => void;
  production: ProductionEditorSettings;
  onProductionChange: (
    index: number,
    option: string,
    value: ProductProductionAssets,
  ) => void;
}) {
  const [name, setName] = useState("");
  const attributes = product.atributos || [];
  const changeGroup = (value: ProductAttribute) =>
    onChange({
      ...product,
      atributos: attributes.map((row, i) => (i === index ? value : row)),
    });
  const normalizedOption = (value: string, previous?: string) => {
    const next = value.trim().replace(/\s+/g, " ");
    if (
      !next ||
      next.length > 80 ||
      next.includes("|") ||
      Object.hasOwn(Object.prototype, next) ||
      attribute.opcoes.some(
        (option) =>
          option !== previous &&
          option.toLocaleLowerCase("pt-BR") === next.toLocaleLowerCase("pt-BR"),
      )
    ) {
      onError("Use um nome diferente, de até 80 caracteres, para cada opção.");
      return "";
    }
    onError("");
    return next;
  };
  const addOption = () => {
    const value = normalizedOption(name);
    if (!value) return;
    const updated = { ...attribute, opcoes: [...attribute.opcoes, value] };
    const nextAttributes = attributes.map((row, i) =>
      i === index ? updated : row,
    );
    if (
      generateProductCombinations(nextAttributes).length >
        ADMIN_LIMITS.combinations &&
      product.precificacao !== "adicionais"
    ) {
      onError(
        `A lista aceita até ${ADMIN_LIMITS.combinations} combinações com preços individuais.`,
      );
      return;
    }
    if (attribute.opcoes.length === 0 && index > 0) {
      const completeKeys = generateProductCombinations(nextAttributes).slice(
        0,
        ADMIN_LIMITS.combinations,
      );
      function expand<T>(values: Record<string, T> | undefined) {
        return Object.fromEntries(
          completeKeys.flatMap((key) => {
            const parts = key.split("|");
            parts.splice(index, 1);
            const previous = values?.[parts.join("|")];
            return previous === undefined ? [] : [[key, previous] as const];
          }),
        );
      }
      onChange({
        ...product,
        atributos: nextAttributes,
        combinacoes: expand(product.combinacoes),
        imagensPorCombinacao: expand(product.imagensPorCombinacao),
        shippingByCombination: expand(product.shippingByCombination),
        skuPorCombinacao: expand(product.skuPorCombinacao),
      });
    } else changeGroup(updated);
    setName("");
  };
  const activeType =
    types.find(
      (type) => type.id === attribute.tipoId && type.name === attribute.nome,
    )?.id || "";
  return (
    <section className="space-y-3 rounded-xl border border-gray-700 bg-[#181818] p-4">
      <div className="flex items-end gap-3">
        <label className="min-w-0 flex-1 text-sm">
          Variação {index + 1}
          <select
            value={activeType}
            className={field + " mt-1"}
            aria-label={`Tipo da variação ${index + 1}`}
            onChange={(event) => {
              const type = types.find((row) => row.id === event.target.value);
              if (type)
                changeGroup({ ...attribute, nome: type.name, tipoId: type.id });
            }}
          >
            {!activeType && <option value="">{attribute.nome}</option>}
            {types
              .filter(
                (type) =>
                  (attributes.length <= 2 || type.id === activeType) &&
                  !used.some(
                    (row) =>
                      row.tipoId === type.id ||
                      row.nome.toLocaleLowerCase("pt-BR") ===
                        type.name.toLocaleLowerCase("pt-BR"),
                  ),
              )
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className={button}
          aria-label={`Remover variação ${attribute.nome}`}
          onClick={() => {
            const remaining = attributes.filter((_, i) => i !== index);
            function project<T>(
              values: Record<string, T> | undefined,
            ): Record<string, T> {
              const byKey = new Map<string, T>();
              const ambiguous = new Set<string>();
              if (!remaining.length) return {};
              for (const [key, value] of Object.entries(values || {})) {
                const parts = key.split("|");
                if (parts.length === attributes.length) parts.splice(index, 1);
                const next = parts.join("|");
                if (
                  byKey.has(next) &&
                  JSON.stringify(byKey.get(next)) !== JSON.stringify(value)
                )
                  ambiguous.add(next);
                byKey.set(next, value);
              }
              return Object.fromEntries(
                [...byKey].filter(([key]) => !ambiguous.has(key)),
              );
            }
            onChange({
              ...product,
              atributos: remaining,
              combinacoes: project(product.combinacoes),
              imagensPorCombinacao: project(product.imagensPorCombinacao),
              shippingByCombination: project(product.shippingByCombination),
              skuPorCombinacao: project(product.skuPorCombinacao),
            });
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {attribute.opcoes.map((option) => (
          <OptionControls
            key={option}
            attribute={attribute}
            option={option}
            config={attribute.configuracao?.[option] || {}}
            additive={product.precificacao === "adicionais"}
            productionEditor={
              <ProductProductionEditor
                {...production}
                product={{
                  id: product.id,
                  imagemBase: attribute.configuracao?.[option]?.imagemBase,
                  moldePdf: attribute.configuracao?.[option]?.moldePdf,
                }}
                optionLabel={`${attribute.nome}: ${option}`}
                onChange={(value) => onProductionChange(index, option, value)}
              />
            }
            onRename={(value) => {
              if (value === option) return true;
              const replacement = normalizedOption(value, option);
              if (!replacement) return false;
              onChange(
                replaceProductOption(product, index, option, replacement),
              );
              return true;
            }}
            onRemove={() =>
              onChange(replaceProductOption(product, index, option))
            }
            onConfig={(patch) => {
              const config = { ...attribute.configuracao?.[option], ...patch };
              const defined = Object.fromEntries(
                Object.entries(config).filter(
                  ([, value]) => value !== undefined,
                ),
              );
              changeGroup({
                ...attribute,
                configuracao: { ...attribute.configuracao, [option]: defined },
              });
            }}
            onUpload={(file) => onUpload(attribute.nome, option, file)}
          />
        ))}
      </div>
      {attribute.opcoes.length < ADMIN_LIMITS.optionsPerAttribute && (
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-gray-400">
            Nova opção
            <input
              className={field + " mt-1"}
              aria-label={`Nova opção de ${attribute.nome}`}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addOption();
                }
              }}
            />
          </label>
          <button
            type="button"
            className={button}
            disabled={!name.trim()}
            onClick={addOption}
          >
            <Plus size={15} /> Adicionar opção
          </button>
        </div>
      )}
    </section>
  );
}

export default function ProductOptionEditor({
  product,
  onChange,
  api,
  onUpload,
  busy,
  onBusy,
  production,
}: {
  product: Partial<Anuncio>;
  onChange: (value: Partial<Anuncio>) => void;
  api: SalesAdminApi;
  onUpload: (attribute: string, option: string, file: File) => void;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  production: ProductionEditorSettings;
}) {
  const [types, setTypes] = useState<VariationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [typeName, setTypeName] = useState("");
  const [savingType, setSavingType] = useState(false);
  const [bulkPrice, setBulkPrice] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError("");
    void api
      .variationTypes()
      .then((result) => {
        if (current)
          setTypes(
            result.rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
          );
      })
      .catch((reason) => {
        if (current) setLoadError(reason.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, reload]);
  const latestProduct = React.useRef(product);
  latestProduct.current = product;
  const attributes = product.atributos || [];
  const changeProduction = (
    index: number,
    option: string,
    { imagemBase, moldePdf }: ProductProductionAssets,
  ) => {
    const current = latestProduct.current;
    const group = current.atributos?.[index];
    if (!group?.opcoes.includes(option)) return;
    const config = { ...group.configuracao?.[option] };
    delete config.imagemBase;
    delete config.moldePdf;
    if (imagemBase) config.imagemBase = imagemBase;
    if (moldePdf) config.moldePdf = moldePdf;
    onChange({
      ...current,
      atributos: current.atributos!.map((attribute, i) =>
        i === index
          ? {
              ...attribute,
              configuracao: { ...attribute.configuracao, [option]: config },
            }
          : attribute,
      ),
    });
  };
  const choices = types.filter(
    (type) =>
      !attributes.some(
        (row) =>
          row.tipoId === type.id ||
          row.nome.toLocaleLowerCase("pt-BR") ===
            type.name.toLocaleLowerCase("pt-BR"),
      ),
  );
  function addType(type: VariationType) {
    const current = latestProduct.current;
    onChange({
      ...current,
      atributos: [
        ...(current.atributos || []),
        { nome: type.name, tipoId: type.id, opcoes: [] },
      ],
    });
    setAdding(false);
    setTypeName("");
  }
  async function createType() {
    setSavingType(true);
    onBusy(true);
    setError("");
    try {
      const name = variationTypeName(typeName);
      if (
        attributes.some(
          (row) =>
            row.nome.toLocaleLowerCase("pt-BR") ===
            name.toLocaleLowerCase("pt-BR"),
        )
      )
        throw new Error("Este produto já usa uma variação com esse nome.");
      const type = await api.saveVariationType(name);
      setTypes((current) =>
        [...current, type].sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR"),
        ),
      );
      addType(type);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSavingType(false);
      onBusy(false);
    }
  }
  const keys = generateProductCombinations(attributes);
  const additive = product.precificacao === "adicionais";
  const view = {
    ...product,
    nome: product.nome || "",
    atributos: attributes,
  } as Anuncio;
  return (
    <fieldset disabled={busy || savingType} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-400">
          Combine até dois tipos de variação. As imagens aqui representam as
          opções na loja. Se duas opções selecionadas tiverem arte própria, vale
          a da primeira variação cadastrada.
        </p>
        {attributes.length < 2 && !adding && (
          <button
            type="button"
            className={button}
            onClick={() => setAdding(true)}
          >
            <Plus size={16} /> Adicionar variação
          </button>
        )}
      </div>
      {loadError && (
        <p role="alert" className="text-sm text-red-300">
          {loadError}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setReload((value) => value + 1)}
          >
            Tentar novamente
          </button>
        </p>
      )}
      {adding && (
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <label className="min-w-0 flex-1 text-sm">
              Tipo de variação
              <select
                aria-label="Tipo de variação"
                className={field + " mt-1"}
                value=""
                disabled={loading || !choices.length}
                onChange={(event) => {
                  const type = choices.find(
                    (row) => row.id === event.target.value,
                  );
                  if (type) {
                    setError("");
                    addType(type);
                  }
                }}
              >
                <option value="">
                  {loading
                    ? "Carregando tipos…"
                    : choices.length
                      ? "Selecione um tipo cadastrado"
                      : "Nenhum tipo cadastrado disponível"}
                </option>
                {choices.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={button}
              onClick={() => {
                setAdding(false);
                setTypeName("");
                setError("");
              }}
            >
              Cancelar
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-40 flex-1 text-sm">
              Novo tipo de variação
              <input
                className={field + " mt-1"}
                value={typeName}
                maxLength={80}
                onChange={(event) => setTypeName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!loading && typeName.trim()) void createType();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className={button}
              disabled={loading || !typeName.trim()}
              onClick={() => void createType()}
            >
              {savingType ? "Cadastrando…" : "Cadastrar e adicionar"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {attributes.map((attribute, index) => (
        <VariationGroup
          key={attribute.tipoId || attribute.nome}
          attribute={attribute}
          index={index}
          types={types}
          used={attributes.filter((_, i) => i !== index)}
          product={product}
          onChange={onChange}
          onUpload={onUpload}
          onError={setError}
          production={production}
          onProductionChange={changeProduction}
        />
      ))}
      {attributes.length > 0 && (
        <label className="block text-sm">
          Modo de preço
          <select
            className={field + " mt-1"}
            aria-label="Modo de preço"
            value={product.precificacao || "combinacoes"}
            onChange={(event) =>
              onChange({
                ...product,
                precificacao: event.target.value as Anuncio["precificacao"],
              })
            }
          >
            <option value="combinacoes">Preço final por combinação</option>
            <option value="adicionais">
              Preço base + adicionais por opção
            </option>
          </select>
        </label>
      )}
      {keys.length > ADMIN_LIMITS.combinations && (
        <p className="text-sm text-gray-400">
          A lista de preços e SKUs individuais suporta até{" "}
          {ADMIN_LIMITS.combinations} combinações.
        </p>
      )}
      {keys.length > 0 && keys.length <= ADMIN_LIMITS.combinations && (
        <div className="space-y-3">
          <h4 className="font-bold">Lista de variações</h4>
          {!additive && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-sm">
                Preço para todas as combinações
                <input
                  className={field + " mt-1"}
                  inputMode="decimal"
                  value={bulkPrice}
                  onChange={(event) => setBulkPrice(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={button}
                disabled={(parseMoneyToCents(bulkPrice) ?? 0) <= 0}
                onClick={() =>
                  onChange({
                    ...product,
                    combinacoes: Object.fromEntries(
                      keys.map((key) => [key, bulkPrice]),
                    ),
                  })
                }
              >
                Aplicar a todos
              </button>
            </div>
          )}
          <div
            className="max-h-[29rem] overflow-auto rounded-xl border border-gray-700"
            tabIndex={0}
            role="region"
            aria-label="Tabela de preços e SKUs"
          >
            <table className="w-full min-w-[35rem] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#242424]">
                <tr>
                  {attributes.map((attribute) => (
                    <th key={attribute.nome} scope="col" className="p-3">
                      {attribute.nome}
                    </th>
                  ))}
                  <th scope="col" className="p-3">
                    Preço
                  </th>
                  <th scope="col" className="p-3">
                    SKU da variação
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key, index) => {
                  const options = key.split("|");
                  const selection = Object.fromEntries(
                    attributes.map((attribute, i) => [
                      attribute.nome,
                      options[i],
                    ]),
                  );
                  const sku = productSku(
                    { ...view, skuPorCombinacao: {} },
                    selection,
                  );
                  const group =
                    attributes.length === 2 ? attributes[1].opcoes.length : 1;
                  const label = options.join(" + ");
                  const amount = additive
                    ? productPrice(view, selection)
                    : null;
                  return (
                    <tr key={key} className="border-t border-gray-800">
                      {options.map((option, i) =>
                        i === 0 && index % group !== 0 ? null : (
                          <td
                            key={i}
                            rowSpan={i === 0 ? group : 1}
                            className="border-r border-gray-800 p-3"
                          >
                            {attributes[i].configuracao?.[option]
                              ?.referencia && (
                              <img
                                src={
                                  attributes[i].configuracao?.[option]
                                    ?.referencia
                                }
                                alt=""
                                className="mb-2 h-10 w-10 rounded object-cover"
                              />
                            )}
                            {option}
                          </td>
                        ),
                      )}
                      <td className="w-32 border-r border-gray-800 p-3">
                        {additive ? (
                          amount === null ? (
                            "—"
                          ) : (
                            formatMoney(amount / 100)
                          )
                        ) : (
                          <input
                            className={field}
                            aria-label={`Preço da combinação ${label}`}
                            inputMode="decimal"
                            value={product.combinacoes?.[key] ?? ""}
                            onChange={(event) =>
                              onChange({
                                ...product,
                                combinacoes: {
                                  ...product.combinacoes,
                                  [key]: event.target.value,
                                },
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="min-w-48 p-3">
                        <input
                          className={field}
                          aria-label={`SKU da combinação ${label}`}
                          maxLength={MAX_COMBINATION_SKU}
                          placeholder={sku}
                          value={product.skuPorCombinacao?.[key] || ""}
                          onChange={(event) =>
                            onChange({
                              ...product,
                              skuPorCombinacao: {
                                ...product.skuPorCombinacao,
                                [key]: event.target.value,
                              },
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </fieldset>
  );
}
