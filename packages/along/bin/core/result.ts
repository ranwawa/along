export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; stack?: string };

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function failure<T>(error: string, stack?: string): Result<T> {
  return { success: false, error, stack };
}
