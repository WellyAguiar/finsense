export interface DefaultCategory {
  name: string;
  slug: string;
  type: "INCOME" | "EXPENSE";
  icon: string;
  color: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // Receitas
  { name: "Salário", slug: "salario", type: "INCOME", icon: "briefcase", color: "#10b981" },
  { name: "Freelance & Extra", slug: "freelance", type: "INCOME", icon: "sparkles", color: "#06b6d4" },
  { name: "Rendimentos", slug: "rendimentos", type: "INCOME", icon: "trending-up", color: "#22c55e" },
  { name: "Reembolsos", slug: "reembolsos", type: "INCOME", icon: "rotate-ccw", color: "#14b8a6" },
  { name: "Outras Receitas", slug: "outras-receitas", type: "INCOME", icon: "plus-circle", color: "#84cc16" },

  // Despesas
  { name: "Moradia", slug: "moradia", type: "EXPENSE", icon: "home", color: "#6366f1" },
  { name: "Supermercado", slug: "supermercado", type: "EXPENSE", icon: "shopping-cart", color: "#f97316" },
  { name: "Alimentação & Delivery", slug: "alimentacao", type: "EXPENSE", icon: "utensils", color: "#ef4444" },
  { name: "Transporte", slug: "transporte", type: "EXPENSE", icon: "car", color: "#3b82f6" },
  { name: "Saúde & Farmácia", slug: "saude", type: "EXPENSE", icon: "heart-pulse", color: "#ec4899" },
  { name: "Assinaturas & Streaming", slug: "assinaturas", type: "EXPENSE", icon: "repeat", color: "#8b5cf6" },
  { name: "Lazer & Viagens", slug: "lazer", type: "EXPENSE", icon: "palmtree", color: "#f59e0b" },
  { name: "Educação", slug: "educacao", type: "EXPENSE", icon: "graduation-cap", color: "#0ea5e9" },
  { name: "Compras & Vestuário", slug: "compras", type: "EXPENSE", icon: "shopping-bag", color: "#d946ef" },
  { name: "Contas & Utilidades", slug: "utilidades", type: "EXPENSE", icon: "zap", color: "#eab308" },
  { name: "Impostos & Tarifas", slug: "impostos", type: "EXPENSE", icon: "landmark", color: "#64748b" },
  { name: "Investimentos & Aportes", slug: "investimentos", type: "EXPENSE", icon: "piggy-bank", color: "#059669" },
  { name: "Pets", slug: "pets", type: "EXPENSE", icon: "paw-print", color: "#a855f7" },
  { name: "Outros", slug: "outros", type: "EXPENSE", icon: "tag", color: "#94a3b8" },
];

export interface DefaultRule {
  pattern: string;
  matchType: "CONTAINS" | "REGEX" | "EXACT";
  cleanMerchant: string;
  categorySlug: string;
  priority: number;
}

export const DEFAULT_RULES: DefaultRule[] = [
  { pattern: "IFD*", matchType: "CONTAINS", cleanMerchant: "iFood", categorySlug: "alimentacao", priority: 10 },
  { pattern: "IFOOD", matchType: "CONTAINS", cleanMerchant: "iFood", categorySlug: "alimentacao", priority: 10 },
  { pattern: "UBER *TRIP", matchType: "CONTAINS", cleanMerchant: "Uber", categorySlug: "transporte", priority: 10 },
  { pattern: "UBER* TRIP", matchType: "CONTAINS", cleanMerchant: "Uber", categorySlug: "transporte", priority: 10 },
  { pattern: "99APP", matchType: "CONTAINS", cleanMerchant: "99", categorySlug: "transporte", priority: 10 },
  { pattern: "NETFLIX", matchType: "CONTAINS", cleanMerchant: "Netflix", categorySlug: "assinaturas", priority: 10 },
  { pattern: "SPOTIFY", matchType: "CONTAINS", cleanMerchant: "Spotify", categorySlug: "assinaturas", priority: 10 },
  { pattern: "AMAZON PRIME", matchType: "CONTAINS", cleanMerchant: "Amazon Prime", categorySlug: "assinaturas", priority: 10 },
  { pattern: "GOOGLE ONE", matchType: "CONTAINS", cleanMerchant: "Google One", categorySlug: "assinaturas", priority: 10 },
  { pattern: "APPLE.COM/BILL", matchType: "CONTAINS", cleanMerchant: "Apple", categorySlug: "assinaturas", priority: 15 },
  { pattern: "DROGASIL", matchType: "CONTAINS", cleanMerchant: "Drogasil", categorySlug: "saude", priority: 15 },
  { pattern: "DROGA RAIA", matchType: "CONTAINS", cleanMerchant: "Droga Raia", categorySlug: "saude", priority: 15 },
  { pattern: "PAGUE MENOS", matchType: "CONTAINS", cleanMerchant: "Pague Menos", categorySlug: "saude", priority: 15 },
  { pattern: "CARREFOUR", matchType: "CONTAINS", cleanMerchant: "Carrefour", categorySlug: "supermercado", priority: 15 },
  { pattern: "PAO DE ACUCAR", matchType: "CONTAINS", cleanMerchant: "Pão de Açúcar", categorySlug: "supermercado", priority: 15 },
  { pattern: "ASSAI", matchType: "CONTAINS", cleanMerchant: "Assaí Atacadista", categorySlug: "supermercado", priority: 15 },
  { pattern: "MERCADOLIVRE", matchType: "CONTAINS", cleanMerchant: "Mercado Livre", categorySlug: "compras", priority: 20 },
  { pattern: "MERCPAGO*", matchType: "CONTAINS", cleanMerchant: "Mercado Pago", categorySlug: "compras", priority: 30 },
  { pattern: "AMAZON.COM.BR", matchType: "CONTAINS", cleanMerchant: "Amazon", categorySlug: "compras", priority: 20 },
  { pattern: "SHELL", matchType: "CONTAINS", cleanMerchant: "Posto Shell", categorySlug: "transporte", priority: 20 },
  { pattern: "IPIRANGA", matchType: "CONTAINS", cleanMerchant: "Posto Ipiranga", categorySlug: "transporte", priority: 20 },
  { pattern: "SMART FIT", matchType: "CONTAINS", cleanMerchant: "Smart Fit", categorySlug: "saude", priority: 15 },
  { pattern: "ENEL", matchType: "CONTAINS", cleanMerchant: "Enel Energia", categorySlug: "utilidades", priority: 15 },
  { pattern: "SABESP", matchType: "CONTAINS", cleanMerchant: "Sabesp", categorySlug: "utilidades", priority: 15 },
  { pattern: "VIVO", matchType: "CONTAINS", cleanMerchant: "Vivo", categorySlug: "utilidades", priority: 20 },
  { pattern: "CLARO", matchType: "CONTAINS", cleanMerchant: "Claro", categorySlug: "utilidades", priority: 20 },
];
