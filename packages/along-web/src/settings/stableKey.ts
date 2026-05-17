let counter = 0;

function nextStableKey() {
  counter += 1;
  return `sk_${counter}`;
}

export type WithKey<T> = T & { _key: string };

export function attachKeys<T>(items: T[]): WithKey<T>[] {
  return items.map((item) => ({ ...item, _key: nextStableKey() }));
}

export function attachKey<T>(item: T): WithKey<T> {
  return { ...item, _key: nextStableKey() };
}

export function stripKey<T>({ _key, ...rest }: WithKey<T>): T {
  return rest as unknown as T;
}

export function stripKeys<T>(items: T[]): T[] {
  return items.map((item) => {
    if (item && typeof item === 'object' && '_key' in item) {
      const { _key, ...rest } = item as Record<string, unknown>;
      return rest as T;
    }
    return item;
  });
}

export function getKey(item: unknown): string {
  return (item as WithKey<unknown>)._key;
}
