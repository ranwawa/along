export function cn(...inputs: (false | null | string | undefined)[]) {
  return inputs.filter(Boolean).join(' ');
}
