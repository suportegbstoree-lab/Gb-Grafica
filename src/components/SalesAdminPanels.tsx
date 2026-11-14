import React, { useEffect, useState } from "react";
import { formatMoney } from "../lib/commerce";
import {
  couponAvailable,
  COUPON_CODE_IN_USE,
  COUPON_CODE_MAX_LENGTH,
  type CouponDraft,
  type SalesCoupon,
} from "../lib/salesCoupons";
import type { VariationType } from "../lib/productSales";
import type { SalesAdminApi } from "../services/salesService";
import type { Anuncio, Category } from "../types";

const field =
  "mt-1 block w-full rounded-lg border border-gray-700 bg-black px-3 py-2";
const primary =
  "rounded-lg bg-[#ff4d79] px-4 py-2 font-bold disabled:opacity-40";
const secondary =
  "rounded-lg border border-gray-700 px-3 py-2 hover:border-pink-500 disabled:opacity-40";

type ConfirmDelete = (label: string, run: () => Promise<void>) => void;

export function VariationTypesPanel({
  api,
  confirmDelete,
}: {
  api: SalesAdminApi;
  confirmDelete: ConfirmDelete;
}) {
  const [rows, setRows] = useState<VariationType[]>([]);
  const [previous, setPrevious] = useState<VariationType>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);

  async function load() {
    const result = await api.variationTypes();
    setRows(result.rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    setTruncated(result.truncated);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(load);
  }, [api]);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Tipos de variação</h2>
        <p className="mt-2 text-sm text-gray-400">
          Cadastre nomes como Estampa ou Customização. As opções e os preços são
          definidos em cada produto.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-800 bg-[#151515] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api.saveVariationType(name, previous);
            setName("");
            setPrevious(undefined);
            await load();
          });
        }}
      >
        <label className="min-w-48 flex-1 text-sm">
          {previous ? "Editar nome do tipo" : "Nome do tipo"}
          <input
            className={field}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        {previous && (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => {
              setPrevious(undefined);
              setName("");
            }}
          >
            Cancelar
          </button>
        )}
        <button className={primary} disabled={busy || !name.trim()}>
          {previous ? "Salvar tipo" : "Cadastrar tipo"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}{" "}
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={() => void run(load)}
          >
            Atualizar lista
          </button>
        </p>
      )}
      {truncated && (
        <p className="text-sm text-amber-300">A lista exibe até 500 tipos.</p>
      )}
      {!busy && !rows.length && (
        <p className="text-sm text-gray-400">Nenhum tipo cadastrado.</p>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-[#151515] p-4"
          >
            <span className="font-medium">{row.name}</span>
            <div className="flex gap-2">
              <button
                type="button"
                className={secondary}
                disabled={busy}
                aria-label={`Editar tipo ${row.name}`}
                onClick={() => {
                  setPrevious(row);
                  setName(row.name);
                }}
              >
                Editar
              </button>
              <button
                type="button"
                className={secondary + " text-red-300"}
                disabled={busy}
                aria-label={`Excluir tipo ${row.name}`}
                onClick={() =>
                  confirmDelete(row.name, () =>
                    run(async () => {
                      await api.deleteVariationType(row);
                      if (previous?.id === row.id) {
                        setPrevious(undefined);
                        setName("");
                      }
                      await load();
                    }),
                  )
                }
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const emptyCoupon: CouponDraft = {
  description: "",
  kind: "percent",
  value: "",
  expiresOn: "",
  limit: 1,
  active: true,
  firstPurchase: false,
  scope: "cart",
  targets: [],
};

export function CouponsPanel({
  api,
  products,
  categories,
  confirmDelete,
}: {
  api: SalesAdminApi;
  products: Anuncio[];
  categories: Category[];
  confirmDelete: ConfirmDelete;
}) {
  const [rows, setRows] = useState<SalesCoupon[]>([]);
  const [draft, setDraft] = useState<CouponDraft>();
  const [previous, setPrevious] = useState<SalesCoupon>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const codeInUse = Boolean(draft && !previous && error === COUPON_CODE_IN_USE);
  const codeErrorId = React.useId();
  const change = (patch: Partial<CouponDraft>) => {
    if (codeInUse && patch.code !== undefined) setError("");
    setDraft((current) => (current ? { ...current, ...patch } : undefined));
  };

  async function load() {
    const result = await api.coupons();
    setRows(
      result.rows.sort(
        (a, b) =>
          b.expiresOn.localeCompare(a.expiresOn) ||
          a.code.localeCompare(b.code),
      ),
    );
    setTruncated(result.truncated);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(load);
  }, [api]);
  const available =
    draft?.scope === "products"
      ? products.map((product) => ({ key: product.id, name: product.nome }))
      : categories.map((category) => ({
          key: category.nome,
          name: category.nome,
        }));
  const targets = [
    ...available,
    ...(draft?.targets || [])
      .filter((key) => !available.some((row) => row.key === key))
      .map((key) => ({ key, name: key })),
  ];
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Cupons de desconto</h2>
          <p className="mt-2 text-sm text-gray-400">
            Crie códigos para compartilhar ou configure um desconto automático
            para a primeira compra.
          </p>
        </div>
        <button
          type="button"
          className={primary}
          disabled={busy || Boolean(draft)}
          onClick={() => {
            setDraft(emptyCoupon);
            setPrevious(undefined);
          }}
        >
          Novo cupom
        </button>
      </div>
      {error && !codeInUse && (
        <p role="alert" className="text-sm text-red-300">
          {error}{" "}
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={() => void run(load)}
          >
            Atualizar lista
          </button>
        </p>
      )}
      {draft && (
        <form
          className="space-y-4 rounded-xl border border-gray-800 bg-[#151515] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api.saveCoupon(draft, previous);
              setDraft(undefined);
              setPrevious(undefined);
              await load();
            });
          }}
        >
          <h3 className="font-bold">
            {previous ? `Editar ${previous.code}` : "Novo cupom"}
          </h3>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            {!previous && (
              <label className="text-sm sm:col-span-2">
                Código do cupom
                <input
                  className={field}
                  maxLength={COUPON_CODE_MAX_LENGTH}
                  value={draft.code ?? ""}
                  onChange={(event) => change({ code: event.target.value })}
                  placeholder="Ex.: GRAFICA10"
                  aria-invalid={codeInUse}
                  aria-describedby={codeInUse ? codeErrorId : undefined}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                {codeInUse && (
                  <span
                    id={codeErrorId}
                    role="alert"
                    className="mt-1 block text-xs text-red-300"
                  >
                    {error}
                  </span>
                )}
                <span className="mt-1 block text-xs text-gray-400">
                  Deixe em branco para gerar um código automaticamente.
                </span>
              </label>
            )}
            <label className="text-sm sm:col-span-2">
              Descrição do cupom
              <input
                className={field}
                maxLength={160}
                value={draft.description}
                onChange={(event) =>
                  change({ description: event.target.value })
                }
                required
              />
            </label>
            <label className="text-sm">
              Tipo de desconto
              <select
                className={field}
                value={draft.kind}
                onChange={(event) =>
                  change({ kind: event.target.value as CouponDraft["kind"] })
                }
              >
                <option value="percent">Porcentagem</option>
                <option value="fixed">Valor fixo</option>
              </select>
            </label>
            <label className="text-sm">
              {draft.kind === "percent" ? "Desconto (%)" : "Desconto (R$)"}
              <input
                className={field}
                inputMode="decimal"
                value={draft.value}
                onChange={(event) => change({ value: event.target.value })}
                required
              />
            </label>
            <label className="text-sm">
              Válido até
              <input
                className={field + " [color-scheme:dark]"}
                type="date"
                value={draft.expiresOn}
                onChange={(event) => change({ expiresOn: event.target.value })}
                required
              />
            </label>
            <label className="text-sm">
              Limite de usos
              <input
                className={field}
                type="number"
                min={Math.max(1, previous?.used ?? 0)}
                max={100_000}
                value={draft.limit || ""}
                onChange={(event) =>
                  change({ limit: Number(event.target.value) })
                }
                required
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Aplicar em
              <select
                className={field}
                value={draft.scope}
                onChange={(event) =>
                  change({
                    scope: event.target.value as CouponDraft["scope"],
                    targets: [],
                  })
                }
              >
                <option value="cart">Todo o carrinho</option>
                <option value="products">Produtos selecionados</option>
                <option value="categories">Categorias selecionadas</option>
                <option value="shipping">Frete</option>
              </select>
            </label>
            {(draft.scope === "products" || draft.scope === "categories") && (
              <fieldset className="max-h-44 space-y-2 overflow-auto rounded-lg border border-gray-700 p-3 sm:col-span-2">
                <legend className="px-1 text-sm">
                  {draft.scope === "products"
                    ? "Produtos elegíveis"
                    : "Categorias elegíveis"}
                </legend>
                {targets.map((target) => (
                  <label
                    key={target.key}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={draft.targets.includes(target.key)}
                      onChange={(event) =>
                        change({
                          targets: event.target.checked
                            ? [...draft.targets, target.key]
                            : draft.targets.filter((key) => key !== target.key),
                        })
                      }
                    />
                    {target.name}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => change({ active: event.target.checked })}
              />{" "}
              Cupom ativo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.firstPurchase}
                onChange={(event) =>
                  change({ firstPurchase: event.target.checked })
                }
              />{" "}
              Aplicar automaticamente na primeira compra
            </label>
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() => {
                setDraft(undefined);
                setError("");
              }}
            >
              Cancelar
            </button>
            <button
              className={primary}
              disabled={
                busy || ((draft.scope === "products" || draft.scope === "categories") && !draft.targets.length)
              }
            >
              Salvar cupom
            </button>
          </div>
        </form>
      )}
      {truncated && (
        <p className="text-sm text-amber-300">A lista exibe até 500 cupons.</p>
      )}
      {!busy && !rows.length && (
        <p className="text-sm text-gray-400">Nenhum cupom cadastrado.</p>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.code}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-[#151515] p-4"
          >
            <div className="space-y-1">
              <p className="font-bold text-pink-300">{row.code}</p>
              <p>
                {row.description} ·{" "}
                {row.kind === "fixed"
                  ? formatMoney(row.amount / 100)
                  : `${row.amount / 100}%`}{row.scope === "shipping" ? " no frete" : ""}
              </p>
              <p className="text-xs text-gray-400">
                {couponAvailable(row, Date.now())
                  ? "Disponível"
                  : row.active
                    ? "Indisponível"
                    : "Inativo"}{" "}
                · até {row.expiresOn.split("-").reverse().join("/")}
                {" · "}
                {row.used}/{row.limit} usos e reservas
                {row.firstPurchase ? " · Primeira compra" : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className={secondary}
                disabled={busy}
                aria-label={`Editar cupom ${row.code}`}
                onClick={() => {
                  setPrevious(row);
                  setDraft({ ...row, value: (row.amount / 100).toFixed(2) });
                }}
              >
                Editar
              </button>
              <button
                type="button"
                className={secondary + " text-red-300"}
                disabled={busy}
                aria-label={`Excluir cupom ${row.code}`}
                onClick={() =>
                  confirmDelete(row.code, () =>
                    run(async () => {
                      await api.deleteCoupon(row);
                      if (previous?.code === row.code) {
                        setPrevious(undefined);
                        setDraft(undefined);
                      }
                      await load();
                    }),
                  )
                }
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
