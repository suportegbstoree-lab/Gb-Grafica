const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function parseMoneyToCents(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    const cents = Math.round(value * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  }

  if (typeof value !== 'string') return null;

  let normalized = value
    .trim()
    .replace(/R\$\s?/gi, '')
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!normalized || normalized.startsWith('-')) return null;

  if (normalized.includes(',')) {
    const decimalSeparator = normalized.lastIndexOf(',');
    const integerPart = normalized.slice(0, decimalSeparator).replace(/[.,]/g, '');
    const decimalPart = normalized.slice(decimalSeparator + 1).replace(/\D/g, '');
    normalized = `${integerPart}.${decimalPart}`;
  } else {
    const dotCount = (normalized.match(/\./g) || []).length;
    if (dotCount === 1) {
      const [integerPart, fractionPart = ''] = normalized.split('.');
      normalized = fractionPart.length === 3
        ? `${integerPart}${fractionPart}`
        : `${integerPart}.${fractionPart}`;
    } else if (dotCount > 1) {
      const parts = normalized.split('.');
      const lastPart = parts.at(-1) || '';
      normalized = lastPart.length === 2
        ? `${parts.slice(0, -1).join('')}.${lastPart}`
        : parts.join('');
    }
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatMoney(value: unknown): string {
  const cents = parseMoneyToCents(value);
  return cents === null ? 'Preço indisponível' : BRL_FORMATTER.format(cents / 100);
}

export function isValidCpf(value: unknown): boolean {
  const cpf = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
}

export function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function isValidBrazilianPhone(value: unknown): boolean {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (digits.length !== 10 && digits.length !== 11) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  return digits.length === 10 || digits[2] === '9';
}

export function formatBrazilianPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  const area = digits.slice(0, 2);
  const number = digits.slice(2);
  const splitAt = number.length > 8 ? 5 : 4;
  return `(${area}) ${number.slice(0, splitAt)}${number.length > splitAt ? `-${number.slice(splitAt)}` : ''}`;
}

export function slugifyDocumentId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createCartItemId(
  productId: string,
  selections: Record<string, string>,
  customText = '',
  fileUrl = '',
): string {
  const canonicalSelections = Object.entries(selections)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, option]) => `${name}:${option}`)
    .join('|');
  const fingerprint = stableHash(`${productId}|${canonicalSelections}|${customText.trim()}|${fileUrl.trim()}`);
  return `${productId}-${fingerprint}`.slice(0, 150);
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
