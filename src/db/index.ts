import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Db = ReturnType<typeof createDb>;

function createDb() {
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

let instance: Db | null = null;

// Lazy proxy: don't require DATABASE_URL at module load (next build evaluates
// route modules without runtime env).
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    instance ??= createDb();
    return Reflect.get(instance, prop, instance);
  },
});
