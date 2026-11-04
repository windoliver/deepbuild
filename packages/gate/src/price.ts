// A definition's price (#325; design: One budget): its checks that cost money, each priced when the definition locks,
// and their total, which the issue's one budget ask names. Pure but for the lookup it is handed.

/** The kinds of spend a check can cost: a live call, a hosted browser run or a model job. */
export type PaidKind = 'live call' | 'hosted browser run' | 'model job';
/** The paid checks of a definition, each with its price, in the definition's order; total_usd is null while any price is unknown. */
export interface Pricing { total_usd: number | null; checks: { req: string; check: string; paid: PaidKind; usd: number | null }[] }

/** Prices each paid check of a definition, all lookups at once; a check that costs nothing is never looked up. */
export async function priceDefinition(
  requirements: readonly { id: string; check: string | null; paid?: PaidKind }[],
  price: (check: { check: string; paid: PaidKind }) => Promise<number | null>,
): Promise<Pricing> {
  const paid = requirements.filter((r): r is { id: string; check: string; paid: PaidKind } => typeof r.check === 'string' && r.paid !== undefined);
  const prices = await Promise.all(paid.map((r) => price({ check: r.check, paid: r.paid }).catch(() => null)));
  const checks = paid.map((r, i) => {
    const usd = prices[i];
    return { req: r.id, check: r.check, paid: r.paid, usd: typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : null };
  });
  // Summed in micro-dollars, so cents add up exactly; a price nobody knows leaves the total unknown, never free.
  const total = checks.every((c) => c.usd !== null) ? checks.reduce((sum, c) => sum + Math.round(c.usd! * 1e6), 0) / 1e6 : null;
  return { total_usd: total, checks };
}
