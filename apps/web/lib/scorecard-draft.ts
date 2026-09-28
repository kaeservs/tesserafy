/**
 * A scorecard being written, before it is published (ADR 0016).
 *
 * These are the rules `publish_scorecard` enforces, repeated here so the editor
 * can say what is wrong as it is typed and the trial route can refuse a draft
 * before spending anything on it. The database is still the authority: a draft
 * that passes here and fails there is refused there, with its message.
 *
 * No server imports, so the editor can use it in the browser.
 */

export interface DraftCriterion {
  readonly key: string;
  readonly label: string;
  readonly definition: string;
  readonly weight: number;
}

export const NAME_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
export const KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
export const MIN_CRITERIA = 2;
export const MAX_CRITERIA = 12;
export const LABEL_MAX = 60;
export const DEFINITION_MIN = 20;
export const DEFINITION_MAX = 600;
export const WEIGHTS = [0.5, 1, 1.5, 2, 3] as const;

/** "Next step booked" → "next_step_booked", "3rd call" → "c_3rd_call". */
export function keyFor(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 38);
  if (slug.length < 2) return '';
  return /^[a-z]/.test(slug) ? slug : `c_${slug}`.slice(0, 40);
}

/** "Product demo" → "product-demo". */
export function nameFor(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : '';
}

/**
 * Everything wrong with a draft, in the order a person would fix it. Empty
 * when it may be published. `templates` are names no company may take.
 */
export function draftProblems(
  name: string,
  criteria: readonly DraftCriterion[],
  templates: readonly string[] = [],
): string[] {
  const problems: string[] = [];

  if (!NAME_PATTERN.test(name)) {
    problems.push('Give the scorecard a name that starts with a letter (2 to 40 letters, digits or spaces).');
  } else if (templates.includes(name)) {
    problems.push(`"${name}" is the name of a Tesserafy template. Choose another.`);
  }

  if (criteria.length < MIN_CRITERIA || criteria.length > MAX_CRITERIA) {
    problems.push(`A scorecard has ${MIN_CRITERIA} to ${MAX_CRITERIA} criteria.`);
  }

  const seen = new Set<string>();
  criteria.forEach((criterion, index) => {
    const which = criterion.label.trim() || `Criterion ${index + 1}`;
    const label = criterion.label.trim();
    if (label.length < 1 || label.length > LABEL_MAX) {
      problems.push(`Criterion ${index + 1} needs a name of up to ${LABEL_MAX} characters.`);
    }
    if (!KEY_PATTERN.test(criterion.key)) {
      problems.push(`${which}: its name needs at least two letters or digits.`);
    } else if (seen.has(criterion.key)) {
      problems.push(`${which}: another criterion has the same name.`);
    }
    seen.add(criterion.key);
    const definition = criterion.definition.trim().length;
    if (definition < DEFINITION_MIN || definition > DEFINITION_MAX) {
      problems.push(
        `${which}: describe what counts in ${DEFINITION_MIN} to ${DEFINITION_MAX} characters — it is what the detector listens for.`,
      );
    }
    if (!Number.isFinite(criterion.weight) || criterion.weight < 0.5 || criterion.weight > 3) {
      problems.push(`${which}: weight is between 0.5 and 3.`);
    }
  });

  return problems;
}

/**
 * A request body, checked. Anything that is not a well-formed draft comes back
 * as null rather than being coerced into one.
 */
export function parseDraft(body: unknown): { name: string; criteria: DraftCriterion[] } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { name, criteria } = body as { name?: unknown; criteria?: unknown };
  if (typeof name !== 'string' || !Array.isArray(criteria) || criteria.length > MAX_CRITERIA) return null;

  const parsed: DraftCriterion[] = [];
  for (const item of criteria as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const { key, label, definition, weight } = item as Record<string, unknown>;
    if (typeof key !== 'string' || typeof label !== 'string' || typeof definition !== 'string') return null;
    if (typeof weight !== 'number') return null;
    parsed.push({ key, label: label.trim(), definition: definition.trim(), weight });
  }
  return { name: name.trim(), criteria: parsed };
}
