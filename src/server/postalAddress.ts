import axios from 'axios';
import { fiscalText, isFiscalState, validCityCode } from '../lib/nfe.js';

export async function lookupPostalAddress(cep: string) {
  if (!/^\d{8}$/.test(cep)) return null;
  const { data } = await axios.get<{ erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string; ibge?: string }>(
    'https://viacep.com.br/ws/' + cep + '/json/', { timeout: 5000 },
  );
  const state = fiscalText(data?.uf, 2)?.toUpperCase() ?? '';
  const city = fiscalText(data?.localidade, 90) ?? '';
  if (data?.erro === true || data?.erro === 'true' || !isFiscalState(state) || !city) return null;
  const code = fiscalText(data?.ibge, 7) ?? '';
  return {
    cep, state, city,
    street: fiscalText(data?.logradouro, 160) ?? '',
    neighborhood: fiscalText(data?.bairro, 60) ?? '',
    cityCode: validCityCode(code, state) ? code : '',
  };
}
