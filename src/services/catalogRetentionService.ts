import { auth } from "../firebase";
import { apiFetch } from "./apiClient";
import { apiErrorMessage } from "../lib/apiError";
import { isRetainedAssetPath } from "../lib/catalogRetention";

export async function retireCatalogAsset(path: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sua sessão expirou. Entre novamente.");
  if (!isRetainedAssetPath(path) || !path.startsWith("catalog/"))
    throw new Error("Caminho de arquivo inválido.");
  const response = await apiFetch("/api/admin/catalog-assets/retire", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      apiErrorMessage(data, "Não foi possível agendar a limpeza do arquivo."),
    );
}
