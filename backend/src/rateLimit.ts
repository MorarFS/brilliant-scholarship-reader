type Bucket = { count: number; resetsAt: number };

export function createRateLimiter(limit: number, now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>();
  return {
    allow(subject: string): boolean {
      const currentTime = now();
      const current = buckets.get(subject);
      if (!current || current.resetsAt <= currentTime) {
        buckets.set(subject, { count: 1, resetsAt: currentTime + 60 * 60 * 1_000 });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
  };
}
