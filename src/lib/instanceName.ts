export function makeInstanceName(elementName: string, existing: Set<string>): string {
  const base = elementName.replace(/[^a-zA-Z0-9_]/g, '_');
  for (let i = 0; i < 1000; i++) {
    const candidate = `${base}${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}${Date.now()}`;
}
