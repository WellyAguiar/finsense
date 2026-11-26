import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(cents: number, opts?: { showSign?: boolean }): string {
  const value = cents / 100;
  const formatted = brlFormatter.format(Math.abs(value));
  if (cents < 0) return `-${formatted}`;
  if (opts?.showSign && cents > 0) return `+${formatted}`;
  return formatted;
}

export function parseBRLToCents(input: string | number): number {
  if (typeof input === "number") {
    return Math.round(input * 100);
  }
  const cleaned = input
    .trim()
    .replace(/[R$\s]/g, "")
    .replace(/\.(?=\d{3}(?:,|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function getCurrentMonthKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return getCurrentMonthKey(d);
}

export function getMonthRange(monthKey: string): { start: string; end: string; daysInMonth: number } {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
    daysInMonth: lastDay,
  };
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatShortMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return `${label.charAt(0).toUpperCase() + label.slice(1)}/${String(y).slice(-2)}`;
}

export function formatDateBR(isoDate: string | Date): string {
  if (isoDate instanceof Date) {
    return isoDate.toLocaleDateString("pt-BR");
  }
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits).replace(".", ",")}%`;
}
