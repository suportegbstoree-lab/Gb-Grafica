import React from "react";
import type { Anuncio } from "../types";
const field = "rounded border border-gray-700 bg-black px-3 py-2 text-sm";
export default function ProductOptionEditor({
  product,
  onChange,
}: {
  product: Partial<Anuncio>;
  onChange: (p: Partial<Anuncio>) => void;
}) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-gray-700 p-4 md:col-span-2">
      <legend className="px-2 font-bold">
        Preço e personalização das opções
      </legend>
      <label className="block text-sm">
        Modo de preço
        <select
          aria-label="Modo de preço"
          className={field + " ml-3"}
          value={product.precificacao || "combinacoes"}
          onChange={(e) =>
            onChange({
              ...product,
              precificacao: e.target.value as Anuncio["precificacao"],
            })
          }
        >
          <option value="combinacoes">
            Preço final por combinação (atual)
          </option>
          <option value="adicionais">
            Preço base + adicional de cada opção
          </option>
        </select>
      </label>
      <p className="text-xs text-gray-400">
        Em adicionais, cada escolha soma ao preço base. Desative nome ou imagem
        nas opções “Sem nome” e “Sem imagem”. A imagem-base continua sendo o
        fundo da impressão.
      </p>
      {(product.atributos || []).map((attr, i) => (
        <section key={attr.nome} className="space-y-2">
          <h4 className="text-sm font-bold">{attr.nome}</h4>
          {attr.opcoes.map((option) => {
            const config = attr.configuracao?.[option] || {};
            const update = (patch: object) =>
              onChange({
                ...product,
                atributos: product.atributos!.map((a, n) =>
                  n === i
                    ? {
                        ...a,
                        configuracao: {
                          ...a.configuracao,
                          [option]: { ...config, ...patch },
                        },
                      }
                    : a,
                ),
              });
            return (
              <div
                key={option}
                className="flex flex-wrap items-center gap-3 rounded-lg bg-black/30 p-3"
              >
                <span className="min-w-24 text-sm">{option}</span>
                {product.precificacao === "adicionais" && (
                  <label className="text-xs">
                    Adicional R${" "}
                    <input
                      aria-label={`Adicional ${attr.nome}: ${option}`}
                      className={field + " w-24"}
                      inputMode="decimal"
                      value={config.adicional ?? "0"}
                      onChange={(e) => update({ adicional: e.target.value })}
                    />
                  </label>
                )}
                {(["texto", "imagem"] as const).map((key) => (
                  <label key={key} className="text-xs">
                    {key === "texto" ? "Nome" : "Imagem"}{" "}
                    <select
                      aria-label={`${key} ${attr.nome}: ${option}`}
                      className={field}
                      value={
                        config[key] === undefined
                          ? "herdar"
                          : String(config[key])
                      }
                      onChange={(e) => {
                        const next = { ...config };
                        if (e.target.value === "herdar") delete next[key];
                        else next[key] = e.target.value === "true";
                        onChange({
                          ...product,
                          atributos: product.atributos!.map((a, n) =>
                            n === i
                              ? {
                                  ...a,
                                  configuracao: {
                                    ...a.configuracao,
                                    [option]: next,
                                  },
                                }
                              : a,
                          ),
                        });
                      }}
                    >
                      <option value="herdar">Do produto</option>
                      <option value="true">Habilitado</option>
                      <option value="false">Desabilitado</option>
                    </select>
                  </label>
                ))}
              </div>
            );
          })}
        </section>
      ))}
    </fieldset>
  );
}
