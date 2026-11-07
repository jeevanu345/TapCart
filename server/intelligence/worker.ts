import type { Database } from "../db.js";
import { detectAnomalies } from "./anomalies.js";
import { logger } from "../logger.js";
export function startIntelligenceWorker(db: Database) {
  let running = false,
    stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const stores = (await db.query("SELECT id FROM store WHERE status='APPROVED' ORDER BY id"))
        .rows;
      for (const store of stores) {
        if (stopped) break;
        await detectAnomalies(db, store.id);
      }
    } catch {
      logger.warn("Operational anomaly check needs retry");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5 * 60000);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
