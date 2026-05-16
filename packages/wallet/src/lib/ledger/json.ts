export function isSameJsonObject(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(sortJsonObject(left)) === JSON.stringify(sortJsonObject(right));
}

function sortJsonObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonObject);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [key, sortJsonObject(entryValue)]),
    );
  }

  return value;
}
