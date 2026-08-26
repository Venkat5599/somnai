import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware class merge, required by shadcn-registry components.
 *
 * PRISM's own primitives use `cx` from components/ui.tsx — a plain filter+join,
 * because nothing in the house style needs conflict resolution. This exists
 * only for third-party registry components that import it.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
