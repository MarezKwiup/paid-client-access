export function formatMoney(amountMinor: number, currency: string): string {
    const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(amountMinor / 10 ** digits);
}