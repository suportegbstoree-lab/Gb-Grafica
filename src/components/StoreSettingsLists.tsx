import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { SiteConfig, StoreContact } from '../types';
import { storeBenefits, storeContacts } from '../lib/storePresentation';

const input = 'w-full min-w-0 rounded-lg border border-gray-800 bg-black px-3 py-2 text-sm outline-none focus:border-[#ff4d79]';
const action = 'rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30';
function moved<T>(items: T[], index: number, direction: number): T[] {
  const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next;
}

export default function StoreSettingsLists({ config, onChange }: { config: SiteConfig; onChange: (changes: Partial<SiteConfig>) => void }) {
  const contacts = config.contatos ?? storeContacts(config); const benefits = config.beneficios ?? storeBenefits(config);
  return <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
    <section aria-label="Atendimento" className="space-y-5 rounded-xl border border-gray-800 bg-[#111111] p-6">
      <h3 className="font-bold">Atendimento</h3>
      <p className="text-xs text-gray-500">Escolha os canais da loja. E-mail, telefone e WhatsApp são opcionais.</p>
      {contacts.map((contact, index) => <fieldset key={contact.id} className="min-w-0 space-y-3 rounded-lg border border-gray-800 p-3">
        <legend className="px-1 text-xs text-gray-400">Contato {index + 1}</legend>
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-400">Tipo do contato {index + 1}<select aria-label={`Tipo do contato ${index + 1}`} value={contact.type} onChange={event => onChange({ contatos: contacts.map((item, i) => i === index ? { ...item, type: event.target.value as StoreContact['type'], value: '' } : item) })} className={input}><option value="whatsapp">WhatsApp</option><option value="phone">Telefone</option><option value="email">E-mail</option></select></label>
          <label className="text-xs text-gray-400">Nome do contato {index + 1}<input aria-label={`Nome do contato ${index + 1}`} value={contact.label} maxLength={60} onChange={event => onChange({ contatos: contacts.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} className={input} /></label>
        </div>
        <label className="block text-xs text-gray-400">Valor do contato {index + 1}<input aria-label={`Valor do contato ${index + 1}`} type={contact.type === 'email' ? 'email' : 'tel'} value={contact.value} maxLength={160} placeholder={contact.type === 'email' ? 'atendimento@empresa.com.br' : '(16) 99999-9999'} onChange={event => onChange({ contatos: contacts.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} className={input} /></label>
        <div className="flex justify-end"><button type="button" className={action} disabled={index === 0} aria-label={`Subir contato ${index + 1}`} onClick={() => onChange({ contatos: moved(contacts, index, -1) })}><ArrowUp size={16} /></button><button type="button" className={action} disabled={index === contacts.length - 1} aria-label={`Descer contato ${index + 1}`} onClick={() => onChange({ contatos: moved(contacts, index, 1) })}><ArrowDown size={16} /></button><button type="button" className={action} aria-label={`Remover contato ${index + 1}`} onClick={() => onChange({ contatos: contacts.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>
      </fieldset>)}
      <button type="button" disabled={contacts.length >= 12} onClick={() => onChange({ contatos: [...contacts, { id: crypto.randomUUID(), type: 'whatsapp', label: 'Atendimento', value: '' }] })} className="flex items-center gap-2 text-sm font-bold text-pink-400 disabled:opacity-30"><Plus size={16} /> Adicionar meio de contato</button>
    </section>
    <section aria-label="Benefícios da loja" className="space-y-5 rounded-xl border border-gray-800 bg-[#111111] p-6">
      <h3 className="font-bold">Benefícios da loja</h3>
      {benefits.map((benefit, index) => <fieldset key={benefit.id} className="min-w-0 space-y-3 rounded-lg border border-gray-800 p-3">
        <legend className="px-1 text-xs text-gray-400">Benefício {index + 1}</legend>
        <input aria-label={`Título do benefício ${index + 1}`} value={benefit.title} maxLength={100} placeholder="Título" onChange={event => onChange({ beneficios: benefits.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} className={input} />
        <input aria-label={`Descrição do benefício ${index + 1}`} value={benefit.description} maxLength={180} placeholder="Descrição" onChange={event => onChange({ beneficios: benefits.map((item, i) => i === index ? { ...item, description: event.target.value } : item) })} className={input} />
        <div className="flex justify-end"><button type="button" className={action} disabled={index === 0} aria-label={`Subir benefício ${index + 1}`} onClick={() => onChange({ beneficios: moved(benefits, index, -1) })}><ArrowUp size={16} /></button><button type="button" className={action} disabled={index === benefits.length - 1} aria-label={`Descer benefício ${index + 1}`} onClick={() => onChange({ beneficios: moved(benefits, index, 1) })}><ArrowDown size={16} /></button><button type="button" className={action} aria-label={`Remover benefício ${index + 1}`} onClick={() => onChange({ beneficios: benefits.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>
      </fieldset>)}
      <button type="button" disabled={benefits.length >= 12} onClick={() => onChange({ beneficios: [...benefits, { id: crypto.randomUUID(), title: '', description: '' }] })} className="flex items-center gap-2 text-sm font-bold text-pink-400 disabled:opacity-30"><Plus size={16} /> Adicionar benefício</button>
    </section>
  </div>;
}
