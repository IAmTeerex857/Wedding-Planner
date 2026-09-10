/** Thousands grouping for money fields. Kept out of the component file so fast
 *  refresh still works there. */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** "1200000" -> "1,200,000" and "1200000.5" -> "1,200,000.5" */
export function formatAmount(raw: string | number) {
  const text = String(raw ?? '')
  if (!text) return ''
  const [whole = '', fraction] = text.split('.')
  const digits = whole.replace(/\D/g, '')
  const grouped = digits ? group(digits) : ''
  return fraction === undefined ? grouped : `${grouped}.${fraction.replace(/\D/g, '')}`
}

/** Strips grouping so state always holds a plain number string. */
export function parseAmount(display: string) {
  const cleaned = display.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = cleaned.split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}
