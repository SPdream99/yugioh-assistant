/**
 * Citation selection for ruling answers.
 *
 * A generic keyword search is not good enough: asking about Ash Blossom used to
 * return the Summoning page because the words overlapped. This module maps the
 * *mechanic* to the document that actually defines it, then searches inside that
 * section so the page number is precise.
 */

import { searchRulebook } from "./official-rulebook.js";
import { searchJudgeDocs } from "./official-docs.js";

export interface RuleCitation {
  source: "official_rulebook" | "official_konami_documents";
  citation: string;
  snippet: string;
  mechanic: string;
}

export type Mechanic =
  | "negation"
  | "cost"
  | "targeting"
  | "timing"
  | "damageStep"
  | "chain"
  | "hopt"
  | "summon"
  | "battle";

interface SourcePlan {
  /** Rulebook section to search inside (null = the rulebook does not cover it). */
  rulebookSection?: string;
  /** Query used inside that section. */
  rulebookQuery?: string;
  /** PSCT article that defines the concept. */
  psctDocument?: string;
  psctQuery?: string;
}

/** Mechanic → the document that actually defines it. */
const PLANS: Record<Mechanic, SourcePlan> = {
  negation: {
    rulebookSection: "Chains and Spell Speed",
    rulebookQuery: "chain resolve negate",
    psctDocument: "psct-3",
    psctQuery: "negate the activation negate the effect"
  },
  cost: {
    psctDocument: "psct-3",
    psctQuery: "cost semicolon pay"
  },
  targeting: {
    psctDocument: "psct-3",
    psctQuery: "target choose at activation"
  },
  timing: {
    psctDocument: "psct-7",
    psctQuery: "if versus when timing missed"
  },
  damageStep: {
    rulebookSection: "Monster Battle Rules",
    rulebookQuery: "damage step activate",
    psctDocument: "psct-4",
    psctQuery: "damage step"
  },
  chain: {
    rulebookSection: "Chains and Spell Speed",
    rulebookQuery: "spell speed chain link",
    psctDocument: "psct-3",
    psctQuery: "chain link resolution"
  },
  hopt: {
    psctDocument: "psct-3",
    psctQuery: "once per turn activation"
  },
  summon: {
    rulebookSection: "Summoning Monster Cards",
    rulebookQuery: "fusion summon materials",
    psctDocument: "psct-5",
    psctQuery: "special summon"
  },
  battle: {
    rulebookSection: "Monster Battle Rules",
    rulebookQuery: "battle damage attack",
    psctDocument: "psct-4",
    psctQuery: "battle"
  }
};

const SECTION_ORDER = [
  "Chains and Spell Speed",
  "Monster Battle Rules",
  "Summoning Monster Cards",
  "Turn Structure",
  "Fusion Monsters",
  "Spell & Trap Cards"
];

function searchInSection(section: string, query: string): { page: number; section: string; snippet: string } | null {
  const hits = searchRulebook(`${section} ${query}`, 8).hits;
  return hits.find((h) => h.section === section) || null;
}

/** Collects citations for a set of mechanics, de-duplicated and ordered by relevance. */
export function citationsForMechanics(mechanics: Mechanic[], limit = 4): RuleCitation[] {
  const seen = new Set<string>();
  const out: RuleCitation[] = [];
  const ordered = [...new Set(mechanics)].sort(
    (a, b) => SECTION_ORDER.findIndex((s) => PLANS[a].rulebookSection === s) - SECTION_ORDER.findIndex((s) => PLANS[b].rulebookSection === s)
  );

  for (const mechanic of ordered) {
    const plan = PLANS[mechanic];
    if (!plan) continue;

    if (plan.rulebookSection && plan.rulebookQuery) {
      const hit = searchInSection(plan.rulebookSection, plan.rulebookQuery);
      if (hit) {
        const citation = `Official Rulebook v10, p.${hit.page} — ${hit.section}`;
        if (!seen.has(citation)) {
          seen.add(citation);
          out.push({ source: "official_rulebook", citation, snippet: hit.snippet.slice(0, 240), mechanic });
        }
      }
    }

    if (plan.psctDocument && plan.psctQuery) {
      const hit = searchJudgeDocs(plan.psctQuery, { limit: 1, document: plan.psctDocument }).hits[0];
      if (hit) {
        const where = hit.page ? `p.${hit.page}` : hit.section;
        const citation = `${hit.document}, ${where}`;
        if (!seen.has(citation)) {
          seen.add(citation);
          out.push({ source: "official_konami_documents", citation, snippet: hit.snippet.slice(0, 240), mechanic });
        }
      }
    }

    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}

/** Infers mechanics from a free-text question, then cites them. */
export function citationsForQuestion(question: string, limit = 4): RuleCitation[] {
  const q = question.toLowerCase();
  const mechanics: Mechanic[] = [];

  if (/negat|ash blossom|baronne|solemn|veiler|impermanence|called by/.test(q)) mechanics.push("negation");
  if (/cost|discard|tribute|pay|semicolon/.test(q)) mechanics.push("cost");
  if (/target|choose|select/.test(q)) mechanics.push("targeting");
  if (/when .* you can|miss(ed)? timing|if .* you can/.test(q)) mechanics.push("timing");
  if (/damage step/.test(q)) mechanics.push("damageStep");
  if (/chain|spell speed|priority|segoc/.test(q)) mechanics.push("chain");
  if (/once per turn|hopt|sopt/.test(q)) mechanics.push("hopt");
  if (/fusion|synchro|xyz|link|ritual|pendulum|special summon/.test(q)) mechanics.push("summon");
  if (/battle|attack|atk/.test(q)) mechanics.push("battle");

  if (mechanics.length === 0) mechanics.push("chain");
  return citationsForMechanics(mechanics, limit);
}
