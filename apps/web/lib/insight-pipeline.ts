/**
 * The insight pipeline: how many are waiting, decided and ticketed, how long
 * each step takes, and which customers they come from. Pure — rows in, a
 * summary out — so the Insights page and anything after it agree.
 */

const DAY = 86_400_000;

export interface PipelineInsight {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export interface InsightPipeline {
  readonly proposed: number;
  readonly approved: number;
  readonly ticketed: number;
  readonly dismissed: number;
  /** Median days from proposed to a decision, among those decided. */
  readonly daysToDecide: number | null;
  /** Median days from approval to a ticket, among those ticketed. */
  readonly daysToTicket: number | null;
  /** Customers most insights draw on, most first. */
  readonly customers: readonly { readonly name: string; readonly insights: number }[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function insightPipeline(input: {
  readonly insights: readonly PipelineInsight[];
  readonly tickets: readonly { readonly insightId: string; readonly createdAt: string }[];
  /** Which customer each cited call was with, per insight: insight id → customer names. */
  readonly customersOf: ReadonlyMap<string, ReadonlySet<string>>;
}): InsightPipeline {
  const ticketAt = new Map(input.tickets.map((ticket) => [ticket.insightId, ticket.createdAt]));
  const decided = input.insights.filter((insight) => insight.decidedAt !== null);
  const ticketed = input.insights.filter((insight) => ticketAt.has(insight.id));

  const counts = new Map<string, number>();
  for (const insight of input.insights) {
    for (const name of input.customersOf.get(insight.id) ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return {
    proposed: input.insights.filter((insight) => insight.status === 'proposed').length,
    approved: input.insights.filter((insight) => insight.status === 'approved' && !ticketAt.has(insight.id)).length,
    ticketed: ticketed.length,
    dismissed: input.insights.filter((insight) => insight.status === 'dismissed').length,
    daysToDecide: median(decided.map((insight) => (Date.parse(insight.decidedAt!) - Date.parse(insight.createdAt)) / DAY)),
    daysToTicket: median(
      ticketed
        .filter((insight) => insight.decidedAt !== null)
        .map((insight) => Math.max(0, (Date.parse(ticketAt.get(insight.id)!) - Date.parse(insight.decidedAt!)) / DAY)),
    ),
    customers: [...counts.entries()]
      .map(([name, insights]) => ({ name, insights }))
      .sort((a, b) => b.insights - a.insights || a.name.localeCompare(b.name))
      .slice(0, 8),
  };
}
