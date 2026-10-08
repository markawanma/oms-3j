// supabase/tests/helpers/pg.d.ts
// รีโปไม่มี @types/pg (ใช้ pg ใน scripts/*.mjs เท่านั้น) — ประกาศเฉพาะส่วนที่ db.ts ใช้
// เพื่อให้ `npm run typecheck` ผ่านโดยไม่เพิ่ม dependency
declare module "pg" {
  export interface QueryResult {
    rowCount: number | null;
    rows: unknown[];
  }
  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query(sql: string, params?: unknown[]): Promise<QueryResult>;
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
