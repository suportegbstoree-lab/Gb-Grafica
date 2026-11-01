export const ACTIVITY_LABELS: Record<string, string> = {
  'order.label_generated':'Etiqueta de produção gerada', 'order.fulfillment_updated':'Etapa do pedido alterada', 'order.tracking_updated':'Rastreio do pedido alterado', 'order.tracking_consulted':'Rastreio do pedido consultado', 'order.document_downloaded':'Ficha do pedido baixada',
  'document.generated':'PDF interno gerado', 'document.viewed':'PDF interno consultado', 'document.downloaded':'PDF interno baixado', 'document.printed':'PDF aberto para impressão', 'document.shared':'PDF compartilhado', 'document.emailed':'PDF enviado por e-mail',
  'product.created': 'Produto criado', 'product.updated': 'Produto atualizado', 'product.deleted': 'Produto excluído',
  'product.images': 'Imagens do produto alteradas', 'product.personalization': 'Personalização alterada',
  'category.created': 'Categoria criada', 'category.updated': 'Categoria atualizada', 'category.deleted': 'Categoria excluída',
  'promotion.created': 'Promoção criada', 'promotion.updated': 'Promoção atualizada', 'promotion.deleted': 'Promoção excluída',
  'branding.updated': 'Identidade visual alterada', 'fonts.updated': 'Fontes alteradas', 'settings.updated': 'Configurações alteradas',
  'orders.consulted': 'Pedidos consultados', 'order.viewed': 'Pedido consultado', 'artwork.accessed': 'Acesso à arte solicitado', 'artwork.exported': 'Exportação de arte solicitada',
  'production.created': 'Produção registrada', 'production.corrected': 'Produção corrigida', 'production.cancelled': 'Produção cancelada',
};
export interface StaffActivity { id?: string; actor: string; actorName?: string; actorRole?: string; action: string; entityId: string; at: string; }
export function activitySummary(records: StaffActivity[]) {
  const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const employees = new Map<string, { id: string; name: string; role: string; count: number }>();
  const days = new Map<string, number>(), actions = new Map<string, number>();
  for (const row of records) {
    const person = employees.get(row.actor) || { id: row.actor, name: row.actorName || row.actor, role: row.actorRole || '', count: 0 };
    person.count++; employees.set(row.actor, person);
    const day = dayFormatter.format(new Date(row.at));
    days.set(day, (days.get(day) || 0) + 1); actions.set(row.action, (actions.get(row.action) || 0) + 1);
  }
  return { total: records.length, employees: [...employees.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    actions: [...actions].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count) };
}
