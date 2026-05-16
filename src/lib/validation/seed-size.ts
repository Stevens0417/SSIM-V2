export function requiresSeedSize(crop: string | null | undefined): boolean {
  return (crop ?? "").toLowerCase() === "corn";
}

export function isSeedSizeValid(
  crop: string | null | undefined,
  seedSize: string | null | undefined
): boolean {
  if (!requiresSeedSize(crop)) return true;
  return typeof seedSize === "string" && seedSize.trim().length > 0;
}
