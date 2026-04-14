export function fmtCurrency(value: number): string {
  return value.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
  });
}

export function fmtPackageType(value: string | null | undefined): string {
  if (!value) return "Bag";
  if (value.toLowerCase() === "tote") return "Seedpak";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
