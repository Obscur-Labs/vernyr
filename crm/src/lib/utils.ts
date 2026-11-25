import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, last one wins.
 *
 * `clsx` flattens the conditionals; `twMerge` resolves the conflicts between
 * them — without it a component's own `px-3` and a caller's `px-6` both land in
 * the class list and the winner is whichever Tailwind emitted first. That is
 * what makes a variant prop and a `className` override coexist.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
