import type { Anuncio } from "../types";
import { generateProductCombinations } from "../lib/adminValidation";
export default function VariantImagesEditor({
  product,
  onChange,
}: {
  product: Partial<Anuncio>;
  onChange: (value: Partial<Anuncio>) => void;
}) {
  const keys = generateProductCombinations(product.atributos || []);
  if (!product.atributos?.length) return null;
  const images = [
    ...new Set([product.imagem, ...(product.imagens || [])].filter(Boolean)),
  ] as string[];
  return (
    <fieldset className="space-y-3 rounded-xl border border-gray-700 p-4">
      <legend>Imagem por combinação (opcional)</legend>
      <p className="text-xs text-gray-400">
        O preço continua sendo o valor definido para a combinação. Sem vínculo,
        usa a imagem principal.
      </p>
      {keys.map((key) => (
        <label key={key} className="block text-xs">
          {key.replaceAll("|", " + ")}
          <select
            aria-label={`Imagem da combinação ${key}`}
            value={product.imagensPorCombinacao?.[key] || ""}
            onChange={(e) => {
              const map = { ...product.imagensPorCombinacao };
              if (e.target.value) map[key] = e.target.value;
              else delete map[key];
              onChange({ ...product, imagensPorCombinacao: map });
            }}
            className="mt-1 block w-full rounded border border-gray-700 bg-black p-2"
          >
            <option value="">Usar principal</option>
            {images.map((url, i) => (
              <option key={url} value={url}>
                {i === 0 ? "Imagem principal" : `Imagem ${i} da galeria`}
              </option>
            ))}
          </select>
        </label>
      ))}
    </fieldset>
  );
}
