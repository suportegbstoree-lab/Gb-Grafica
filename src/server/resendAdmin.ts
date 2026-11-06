import type { ResendTemplateDefinition } from './resendEmailTemplates.js';

/** Local setup tools only. Never mounted as a public API. */
export class ResendSetupError extends Error {}
export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  capabilities?: { sending?: string; receiving?: string };
  records?: Array<{
    record?: string;
    type: string;
    name: string;
    value: string;
    status?: string;
    priority?: number;
  }>;
}
interface ResendTemplateRow {
  id: string;
  name: string;
  alias?: string | null;
  status: string;
}
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
export function resendDomainName(value: unknown): string {
  if (typeof value !== "string")
    throw new ResendSetupError(
      "Informe apenas o domínio, sem https://, caminho ou e-mail.",
    );
  const name = value.trim().toLowerCase();
  if (
    name.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)
  )
    throw new ResendSetupError(
      "Domínio inválido. Use, por exemplo, gblgrafica.com.br.",
    );
  return name;
}
export class ResendAdmin {
  private availableAt = 0;
  constructor(
    private key: string,
    private fetcher: typeof fetch = fetch,
    private pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    if (!key.trim() || /[\r\n]/.test(key))
      throw new ResendSetupError(
        "Defina RESEND_ADMIN_API_KEY com uma chave Full access, somente no terminal local.",
      );
  }
  private async request(path: string, body?: unknown): Promise<any> {
    await this.pause(Math.max(0, this.availableAt - Date.now()));
    this.availableAt = Date.now() + 600;
    let response: Response;
    try {
      response = await this.fetcher(`https://api.resend.com${path}`, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${this.key.trim()}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ResendSetupError(
        body === undefined
          ? "Não foi possível consultar o Resend. Confira a conexão."
          : "O Resend não confirmou a alteração. Execute novamente o diagnóstico antes de repetir; uma criação pode já ter sido registrada.",
      );
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        throw new ResendSetupError(
          "O Resend recusou a operação. Confira a conta e use uma chave Full access em RESEND_ADMIN_API_KEY.",
        );
      if (response.status === 429)
        throw new ResendSetupError(
          "Limite de consultas do Resend atingido. Aguarde e repita o diagnóstico.",
        );
      throw new ResendSetupError(
        `Resend respondeu HTTP ${response.status}. Confira a operação e a conta antes de repetir.`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new ResendSetupError(
        "Resposta inválida do Resend. Consulte o estado atual antes de repetir uma alteração.",
      );
    }
  }
  private async list<T>(resource: 'domains' | 'templates', label: string): Promise<T[]> {
    const rows: T[] = [],
      cursors = new Set<string>();
    let after = "";
    for (let page = 0; page < 20; page++) {
      const value = await this.request(
        `/${resource}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      );
      if (
        !Array.isArray(value?.data) ||
        value.data.some(
          (row: any) => !validId(row?.id) || typeof row?.name !== "string",
        )
      )
        throw new ResendSetupError(
          `Lista de ${label} inválida; nenhuma alteração foi feita.`,
        );
      rows.push(...value.data);
      if (!value.has_more) return rows;
      const last = value.data.at(-1)?.id;
      if (!last || cursors.has(last))
        throw new ResendSetupError(
          `Paginação de ${label} inválida; nenhuma alteração foi feita.`,
        );
      cursors.add(last);
      after = last;
    }
    throw new ResendSetupError(
      `A conta excede o limite de 20 páginas de ${label} deste diagnóstico.`,
    );
  }
  async listDomains(): Promise<ResendDomain[]> {
    return this.list('domains', 'domínios');
  }

  async setupTemplates(definitions: ResendTemplateDefinition[], apply = false) {
    const existing = await this.list<ResendTemplateRow>('templates', 'modelos');
    const plan = definitions.map(definition => {
      const matches = existing.filter(row => row.alias === definition.alias);
      if (matches.length > 1 || (matches[0] && !['draft', 'published'].includes(matches[0].status))) {
        throw new ResendSetupError(`Estado inesperado para ${definition.alias}. Confira o cadastro no Resend.`);
      }
      return { definition, current: matches[0] };
    });
    const results = [];
    for (const { definition, current } of plan) {
      const action = current?.status === 'published' ? 'publicado' : current ? 'publicar' : 'criar e publicar';
      let id = current?.id;
      if (apply && action !== 'publicado') {
        if (!id) {
          const created = await this.request('/templates', definition);
          if (!validId(created?.id)) throw new ResendSetupError(`O Resend não confirmou a criação de ${definition.alias}. Consulte o plano antes de repetir.`);
          id = created.id;
        }
        const published = await this.request(`/templates/${id}/publish`, {});
        if (published?.id !== id) throw new ResendSetupError(`O Resend não confirmou a publicação de ${definition.alias}. Consulte o plano antes de repetir.`);
      }
      results.push({ alias: definition.alias, id: id || '', status: apply ? 'publicado' : action });
    }
    return results;
  }
  async getDomain(id: string): Promise<ResendDomain> {
    if (!validId(id))
      throw new ResendSetupError("Identificador de domínio inválido.");
    const domain = await this.request(`/domains/${id}`);
    if (
      domain?.id !== id ||
      typeof domain.name !== "string" ||
      typeof domain.status !== "string"
    )
      throw new ResendSetupError("Dados do domínio inválidos.");
    return domain;
  }
  async setupDomain(name: string, apply = false) {
    name = resendDomainName(name);
    const matches = (await this.listDomains()).filter(
      (row) => row.name.toLowerCase() === name,
    );
    if (matches.length > 1)
      throw new ResendSetupError(
        "Mais de um domínio correspondente; confira a conta antes de alterar.",
      );
    let domain = matches[0] ? await this.getDomain(matches[0].id) : undefined;
    if (domain && domain.name.toLowerCase() !== name)
      throw new ResendSetupError(
        "O domínio retornado não corresponde ao solicitado.",
      );
    if (domain?.capabilities?.sending === "disabled")
      throw new ResendSetupError(
        "Este domínio está com envio desativado. Confira a configuração existente antes de habilitar.",
      );
    if (!apply)
      return {
        action: domain
          ? domain.status === "verified"
            ? "ready"
            : "verify"
          : "create",
        domain,
        created: false,
      };
    let created = false;
    if (!domain) {
      const value = await this.request("/domains", {
        name,
        capabilities: { sending: "enabled", receiving: "disabled" },
      });
      if (!validId(value?.id))
        throw new ResendSetupError(
          "Criação sem identificador válido. Consulte a lista antes de repetir.",
        );
      domain = await this.getDomain(value.id);
      created = true;
    }
    if (domain.status !== "verified") {
      await this.request(`/domains/${domain.id}/verify`, {});
      domain = await this.getDomain(domain.id);
    }
    return {
      action: domain.status === "verified" ? "ready" : "pending-dns",
      domain,
      created,
    };
  }
}
export async function inspectResendSenders(
  client: ResendAdmin,
  senders: Record<string, string>,
) {
  const domains = await client.listDomains(),
    details = new Map<string, ResendDomain>();
  const rows: Array<{
    variable: string;
    sender: string;
    domain: string;
    verified: boolean;
    sending: boolean;
  }> = [];
  for (const [variable, sender] of Object.entries(senders)) {
    const name = sender.split("@")[1]?.toLowerCase() || "",
      match = domains.find((domain) => domain.name.toLowerCase() === name);
    if (match && !details.has(match.id))
      details.set(match.id, await client.getDomain(match.id));
    const domain = match && details.get(match.id);
    rows.push({
      variable,
      sender: sender || "(ausente/inválido)",
      domain: name,
      verified: Boolean(domain?.status === "verified"),
      sending: Boolean(
        domain?.status === "verified" &&
          domain.capabilities?.sending !== "disabled",
      ),
    });
  }
  return rows;
}
