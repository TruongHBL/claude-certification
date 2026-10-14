// Job đêm: đồng bộ đơn từ kênh đối tác.
import { applyLegacyOrder } from "../orders/apply.ts";

export function nightlySync(partnerOrderIds: string[]): number {
  let done = 0;
  for (const id of partnerOrderIds) {
    if (applyLegacyOrder({ id, source: "partner" }).status === "processed") done++;
  }
  return done;
}
