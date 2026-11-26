import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { eq } from "drizzle-orm";
import { getDb, categories, categorizationRules } from "./index";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "./seed-data";

export async function ensureBaseSeed() {
  const db = getDb();

  const existingCats = await db.select().from(categories);
  const slugToId = new Map<string, string>(existingCats.map((c) => [c.slug, c.id]));

  for (const cat of DEFAULT_CATEGORIES) {
    if (!slugToId.has(cat.slug)) {
      const [inserted] = await db
        .insert(categories)
        .values({
          name: cat.name,
          slug: cat.slug,
          type: cat.type,
          icon: cat.icon,
          color: cat.color,
          isSystem: true,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        slugToId.set(inserted.slug, inserted.id);
      } else {
        const [found] = await db
          .select()
          .from(categories)
          .where(eq(categories.slug, cat.slug))
          .limit(1);
        if (found) slugToId.set(found.slug, found.id);
      }
    }
  }

  const existingRules = await db.select().from(categorizationRules);
  if (existingRules.length === 0) {
    for (const rule of DEFAULT_RULES) {
      const categoryId = slugToId.get(rule.categorySlug);
      if (!categoryId) continue;
      await db.insert(categorizationRules).values({
        pattern: rule.pattern,
        matchType: rule.matchType,
        cleanMerchant: rule.cleanMerchant,
        categoryId,
        priority: rule.priority,
      });
    }
  }

  return slugToId;
}

if (require.main === module) {
  ensureBaseSeed()
    .then((map) => {
      console.log(`Seed concluído com sucesso! ${map.size} categorias garantidas.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Erro ao rodar seed:", err);
      process.exit(1);
    });
}
