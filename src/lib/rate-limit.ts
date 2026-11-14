/**
 * محدِّد معدل في الذاكرة (نافذة منزلقة). ملاحظة: على Vercel كل نسخة serverless لها ذاكرتها،
 * فهذا حماية "بذل الجهد" فقط. للإنتاج استخدم Upstash/Redis أو Vercel WAF (انظر docs/OPERATIONS.md).
 */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return true;
}
