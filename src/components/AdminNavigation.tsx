import { useEffect, useId, useState } from 'react';
import { ChevronDown, FileText, Image, Layout, List, Package, Settings, ShoppingBag, Tag, Type, Users } from 'lucide-react';
import type { PanelSection } from '../lib/panelAccess';
import { cn } from '../lib/utils';

const groups = {
  orders: { label: 'Pedidos', Icon: ShoppingBag },
  pdf: { label: 'Gerar PDF', Icon: FileText },
  products: { label: 'Produtos', Icon: Package },
  discounts: { label: 'Descontos', Icon: Tag },
  store: { label: 'Loja', Icon: Settings },
  team: { label: 'Equipe', Icon: Users },
};
type Group = keyof typeof groups;
type Entry = { id: PanelSection; label: string; group: Group; order: number; Icon: typeof Layout; organizedLabel?: string; rolesLabel?: string };
const entries: Entry[] = [
  { id: 'operations', label: 'Operações', group: 'team', order: 1, Icon: Layout, organizedLabel: 'Produtividade' },
  { id: 'documents', label: 'Gerar PDF', group: 'pdf', order: 0, Icon: FileText, organizedLabel: 'Oficina de PDFs' },
  { id: 'imported-labels', label: 'Etiquetas importadas', group: 'pdf', order: 1, Icon: Tag },
  { id: 'products', label: 'Produtos', group: 'products', order: 0, Icon: Layout, organizedLabel: 'Catálogo' },
  { id: 'variation-types', label: 'Tipos de variação', group: 'products', order: 2, Icon: List },
  { id: 'bundles', label: 'Pacotes', group: 'products', order: 3, Icon: Package },
  { id: 'categories', label: 'Categorias', group: 'products', order: 1, Icon: List },
  { id: 'orders', label: 'Pedidos', group: 'orders', order: 0, Icon: Package, organizedLabel: 'Pedidos do site' },
  { id: 'shipment-labels', label: 'Etiquetas', group: 'orders', order: 1, Icon: Tag, organizedLabel: 'Etiquetas de envio' },
  { id: 'promotions', label: 'Promoções', group: 'discounts', order: 0, Icon: Tag },
  { id: 'coupons', label: 'Cupons', group: 'discounts', order: 1, Icon: Tag },
  { id: 'branding', label: 'Identidade Visual', group: 'store', order: 0, Icon: Image },
  { id: 'fonts', label: 'Fontes', group: 'pdf', order: 2, Icon: Type },
  { id: 'config', label: 'Configurações', group: 'store', order: 1, Icon: Settings, organizedLabel: 'Informações da Loja' },
  { id: 'email', label: 'E-mails', group: 'store', order: 2, Icon: Settings },
  { id: 'staff', label: 'Funcionários', group: 'team', order: 0, Icon: Settings, rolesLabel: 'Cargos e permissões' },
];

export const ADMIN_MENU_STORAGE_KEY = 'gb-admin-menu-layout';
export type AdminMenuLayout = 'organized' | 'classic';

export default function AdminNavigation({ allowed, active, roles, layout, onSelect }: {
  allowed: readonly PanelSection[];
  active: PanelSection;
  roles: boolean;
  layout: AdminMenuLayout;
  onSelect: (section: PanelSection, roles?: boolean) => void;
}) {
  const id = useId();
  const visible = entries.filter(entry => allowed.includes(entry.id));
  const activeGroup = visible.find(entry => entry.id === active)?.group;
  const [open, setOpen] = useState(activeGroup);
  useEffect(() => { setOpen(activeGroup); }, [activeGroup]);

  if (layout === 'classic') return (
    <nav aria-label="Seções administrativas" className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
      {visible.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => onSelect(id)}
        aria-current={active === id ? 'page' : undefined}
        className={cn('flex w-auto shrink-0 items-center gap-3 rounded-lg px-4 py-3 text-sm font-bold transition-colors lg:w-full', active === id ? 'bg-[#ff4d79] text-white' : 'text-gray-400 hover:bg-gray-800')}>
        <Icon size={18} aria-hidden="true" />{label}
      </button>)}
    </nav>
  );

  const childClass = 'w-full rounded-md px-3 py-2.5 text-left text-sm text-gray-300 hover:bg-gray-800 aria-[current=page]:bg-[#ff4d79]/15 aria-[current=page]:font-semibold aria-[current=page]:text-pink-300';
  return (
    <nav aria-label="Seções administrativas" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:block lg:space-y-1">
      {(Object.keys(groups) as Group[]).map(group => {
        const items = visible.filter(entry => entry.group === group).sort((a, b) => a.order - b.order);
        if (!items.length) return null;
        const { label, Icon } = groups[group];
        const expanded = open === group;
        const childId = `${id}-${group}`;
        return <div key={group} className="contents lg:block">
          <button type="button" aria-expanded={expanded} aria-controls={childId} onClick={() => setOpen(expanded ? undefined : group)}
            className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-gray-800',
              activeGroup === group ? 'bg-[#ff4d79]/10 text-pink-300' : 'text-gray-300')}>
            <Icon size={17} aria-hidden="true" className="shrink-0" />
            <span className="flex-1">{label}</span>
            <ChevronDown size={14} aria-hidden="true" className={cn('shrink-0 transition-transform', expanded && 'rotate-180')} />
          </button>
          <ul id={childId} hidden={!expanded} className="order-last col-span-full my-1 space-y-1 rounded-md border border-gray-800 p-1 lg:ml-3 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:py-0 lg:pl-2">
            {items.map(item => <li key={item.id}>
              <button type="button" className={childClass} onClick={() => onSelect(item.id)}
                aria-current={active === item.id && !roles ? 'page' : undefined}>{item.organizedLabel ?? item.label}</button>
              {item.rolesLabel && <button type="button" className={childClass} onClick={() => onSelect(item.id, true)}
                aria-current={active === item.id && roles ? 'page' : undefined}>{item.rolesLabel}</button>}
            </li>)}
          </ul>
        </div>;
      })}
    </nav>
  );
}
