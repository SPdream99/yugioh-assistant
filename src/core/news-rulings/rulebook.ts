/**
 * Official Konami Rulebook & Tournament Judge Mechanics Guide
 * Covering Fast Effect Timing, Damage Step Sub-Steps, SEGOC, and Core PSCT Mechanics.
 */

/**
 * Returns a comprehensive guide to the Fast Effect Timing flowchart.
 * Explains Open Game State, Box A (Turn Player Actions), Box B (Turn Player Fast Effects),
 * Box C (Opponent Fast Effects), Chain Formation, and Priority Passing.
 */
export function getFastEffectTimingGuide(): string {
  return `=== OFFICIAL KONAMI FAST EFFECT TIMING GUIDE ===

1. FAST EFFECTS DEFINITION:
- Spell Speed 2 (Quick-Play Spells, Normal/Continuous Traps, Monster Quick Effects)
- Spell Speed 3 (Counter Traps - can only be responded to by other Spell Speed 3)
(Spell Speed 1 cards: Normal/Equip/Continuous/Field Spells, Ritual Spells, Ignition & Trigger Monster Effects cannot be used as Fast Effects unless an effect or rule explicitly states so).

2. THE TIMING FLOWCHART PHASES:
--------------------------------------------------------------------------------
[BOX A: OPEN GAME STATE]
- The Turn Player has priority during their Main Phase or Battle Phase open window.
- The Turn Player can perform:
  * Normal Summon, Tribute Summon, Special Summon by rule (e.g. Synchro, Xyz, Link)
  * Set Spell/Trap cards, change battle positions
  * Activate Spell Speed 1 ignition effects or activate Spells
  * Pass priority or declare an action / phase change
--------------------------------------------------------------------------------
[TRIGGER EFFECTS & EVENTS (Yellow Box)]
- When an action does NOT start a chain (e.g. Summoning a monster, drawing for turn)
  or immediately after a Chain finishes resolving:
  1. Check for Trigger Effects (SEGOC order applies).
  2. If any Trigger Effects activate, build the Chain.
  3. If NO Trigger Effects activate, move to Box B.
--------------------------------------------------------------------------------
[BOX B: TURN PLAYER FAST EFFECT WINDOW]
- Turn player receives the right to activate a Fast Effect (Spell Speed 2+).
- If Turn Player activates a Fast Effect -> Opponent responds in Box C -> Chain forms.
- If Turn Player PASSES -> Priority automatically passes to Box C.
--------------------------------------------------------------------------------
[BOX C: OPPONENT FAST EFFECT WINDOW]
- Opponent receives the right to activate a Fast Effect (Spell Speed 2+).
- If Opponent activates a Fast Effect -> Turn Player responds -> Chain forms.
- If Opponent PASSES -> The game state closes and returns to [BOX A: Open Game State].
--------------------------------------------------------------------------------
[CHAIN RESOLUTION]
- When both players pass consecutively without adding to the Chain:
  * The Chain resolves in reverse order (LIFO: Last In, First Out).
  * Neither player can activate cards or effects WHILE a chain is resolving.
  * Once the chain fully resolves, the game checks for new Trigger Effects or moves back to Box B.
================================================================================`;
}

/**
 * Returns a detailed guide to the 5 Sub-Steps of the Damage Step
 * and exactly what can and cannot be activated in each.
 */
export function getDamageStepGuide(): string {
  return `=== DAMAGE STEP: 5 SUB-STEPS & LEGAL ACTIVATIONS GUIDE ===

General Rule: During the Damage Step, only a restricted subset of cards can be activated:
1. Counter Trap Cards (Spell Speed 3).
2. Mandatory Trigger Effects.
3. Fast Effects that directly alter ATK/DEF (only up to Before Damage Calculation).
4. Effects that specifically state they activate "during the Damage Step" or "when destroyed by battle".
5. Effects that negate the ACTIVATION of a card/effect (NOT "negate the effect").

--------------------------------------------------------------------------------
SUB-STEP 1: START OF THE DAMAGE STEP
- Occurs immediately after attack declaration is accepted and Damage Step begins.
- Face-down monsters have NOT been flipped face-up yet.
- Permitted Activations:
  * Effects that explicitly activate "at the start of the Damage Step" (e.g. Ally of Justice Catastor, Neo-Spacian Grand Mole).
  * ATK/DEF modifying Fast Effects (e.g. Forbidden Lance, Honest).
  * Continuous effects apply.

--------------------------------------------------------------------------------
SUB-STEP 2: BEFORE DAMAGE CALCULATION
- If the attack target is face-down, it is FLIPPED FACE-UP here.
  * Note: Flip effects DO NOT activate here; their triggers are queued for Sub-Step 4.
- Permitted Activations:
  * Effects that explicitly activate "before damage calculation" (e.g. Drillroid).
  * LAST CHANCE to activate effects that modify ATK/DEF!
  * Effects that negate the activation of an activated effect.

--------------------------------------------------------------------------------
SUB-STEP 3: DURING DAMAGE CALCULATION
- Very brief window where ATK/DEF values are compared and battle damage is inflicted.
- ATK/DEF modifiers CAN NO LONGER BE ACTIVATED (unless specifically restricted to "during damage calculation").
- Permitted Activations:
  * Only effects that explicitly state "during damage calculation" (e.g. Kuriboh, Honest, Injection Fairy Lily).
  * Counter Traps that negate card/effect ACTIVATIONS.

--------------------------------------------------------------------------------
SUB-STEP 4: AFTER DAMAGE CALCULATION
- Battle damage has been inflicted.
- Monsters determined to be destroyed by battle are flagged as "marked for destruction"
  (they cannot be tributed or returned to hand, but are still on the field).
- Permitted Activations:
  * Flip Effects activate here!
  * Effects that activate "after damage calculation" or "when battle damage is inflicted" (e.g. Gorz, Spirit Reaper).
  * Traps/Effects that respond to battle damage.

--------------------------------------------------------------------------------
SUB-STEP 5: END OF THE DAMAGE STEP
- Monsters destroyed by battle are now sent from the field to the Graveyard (or banished if Macro Cosmos is active).
- Permitted Activations:
  * Effects that activate "when this card is destroyed by battle and sent to the GY" (e.g. Sangan, Mystic Tomato, Recruiter effects).
================================================================================`;
}

/**
 * Returns a guide to SEGOC (Simultaneous Effects Go On Chain).
 */
export function getSegocGuide(): string {
  return `=== SEGOC (SIMULTANEOUS EFFECTS GO ON CHAIN) ===

When multiple Trigger Effects meet their activation timing at the same moment
(e.g., several monsters sent to the GY simultaneously as Link Material or destroyed together),
they form a single Chain according to strict priority tiers:

ORDER OF CHAIN LINKS:
1. Turn Player Mandatory Trigger Effects (Chain Link 1, 2, ... player chooses order)
2. Opponent's Mandatory Trigger Effects (Next Chain Links in player's choice of order)
3. Turn Player Optional Trigger Effects (Next Chain Links in player's choice of order)
4. Opponent's Optional Trigger Effects (Next Chain Links in player's choice of order)

AFTER ALL TRIGGER EFFECTS ARE PLACED ON CHAIN:
- The opponent can then respond with Fast Effects (Spell Speed 2+) to the last Chain Link.

CHAIN BLOCKING:
- By placing an important effect at Chain Link 1 and another simultaneous trigger at Chain Link 2,
  the Turn Player protects Chain Link 1 from cards that must respond directly to activation
  (e.g., Ash Blossom & Joyous Spring, Solemn Strike), because those cards can only respond to CL2!
================================================================================`;
}

/**
 * Explains specific Yu-Gi-Oh! card mechanics, rulings, and PSCT conventions.
 */
export function explainMechanic(term: string): string {
  const normalized = term.trim().toLowerCase();

  if (normalized.includes('cost') || normalized.includes('effect')) {
    return `=== COST VS EFFECT (PSCT: COLONS & SEMICOLONS) ===
Under Problem-Solving Card Text (PSCT):
Format: <Activation Timing / Conditions>: <Actions at Activation / Costs / Targeting>; <Resolution / Effect>

- COST (Before the Semicolon ';'):
  * Paid immediately when the card/effect is activated.
  * Cannot be refunded even if the activation or effect is negated.
  * Costs do NOT count as "sent to GY by card effect" (e.g., Shaddoll or Tearlaments monsters discarded for Super Polymerization or Twin Twisters COST will NOT trigger their effects).
  * Example: "Discard 1 card; draw 2 cards." -> Discarding is COST.

- EFFECT (After the Semicolon ';'):
  * Happens at chain resolution.
  * If the effect is negated, nothing after the semicolon happens.
  * Cards sent during resolution ARE sent by card effect (e.g., discard for Danger! or Dark World is an EFFECT, triggering Shaddolls/Dark Worlds).`;
  }

  if (normalized.includes('target')) {
    return `=== TARGETING IN YU-GI-OH! ===
- An effect TARGETS if and only if:
  1. The card text explicitly uses the word "target" (e.g., "Target 1 monster on the field; destroy it").
  2. It is an Equip Spell Card targeting a monster.
- If a card says "Choose", "Select", "Send 1 card", or "Destroy 1 monster" WITHOUT the word "target", it DOES NOT TARGET.
- Targeting occurs at ACTIVATION (before the semicolon ';'). Non-targeting choices are made at RESOLUTION.
- "Cards that cannot be targeted by card effects" are completely immune to targeting effects, but CAN still be affected by non-targeting effects (e.g., Mirrorjade the Iceblade Dragon, Evenly Matched, Zeus).`;
  }

  if (normalized.includes('missing timing') || normalized.includes('timing') || normalized.includes('when')) {
    return `=== MISSING THE TIMING ("WHEN" vs "IF") ===
Trigger Effects depend on their exact phrasing:

1. "IF... you can": (OPTIONAL - NEVER MISSES TIMING)
   * Example: "If this card is sent to the GY: You can add 1 card..."
   * Can activate on a new chain as long as the trigger condition happened at any point during the previous chain/action.

2. "WHEN... you can": (OPTIONAL - CAN MISS TIMING)
   * Example: "When this card is Normal Summoned: You can..." or "When this card is sent to the GY: You can..."
   * Requires the trigger event to be the VERY LAST THING to happen before the chain finishes.
   * If the trigger happens at Chain Link 2+, or as Cost, or as intermediate step ("and if you do"), it MISSES TIMING and cannot activate.

3. "WHEN... [Mandatory]": (MANDATORY - NEVER MISSES TIMING)
   * If the effect lacks "you can", it is mandatory and will trigger even if it was not the last thing to happen.`;
  }

  if (normalized.includes('negate activation') || normalized.includes('negate effect')) {
    return `=== NEGATE ACTIVATION VS NEGATE EFFECT ===
- "Negate the ACTIVATION" (e.g. Baronne de Fleur, Solemn Judgment, Borreload Savage Dragon):
  * The activation is treated as having never occurred.
  * The card is NOT considered to have been activated. If a card says "You can only activate this card name once per turn", you CAN activate another copy this turn!
  * CAN be activated during the Damage Step.

- "Negate the EFFECT" (e.g. Ash Blossom & Joyous Spring, Infinite Impermanence, Effect Veiler):
  * The activation still happened, but its resolution does nothing.
  * Once-per-turn restrictions on "activate" are STILL CONSUMED (you cannot activate another copy).
  * CANNOT be activated during the Damage Step (unless explicitly permitted).`;
  }

  if (normalized.includes('banish') || normalized.includes('gy') || normalized.includes('graveyard')) {
    return `=== BANISH VS GRAVEYARD INTERACTIONS ===
- Cards sent "to the Graveyard" must actually reach the GY.
- Under floodgates like Dimension Shifter, Macro Cosmos, or Dimensional Fissure:
  * Cards that require being sent to the GY "as cost" (e.g., Effect Veiler, Droll & Lock Bird, Ghost Ogre) CANNOT be activated, because the cost cannot be physically paid to the GY.
  * Cards that discard to the GY (without specifically requiring GY destination) will be banished instead, but still successfully discarded.
- "Face-down banished cards":
  * Have no properties (no Type, Attribute, Name, Level, ATK/DEF).
  * Cannot be targeted by cards that refer to specific card types or names.`;
  }

  if (normalized.includes('destroy') || normalized.includes('send')) {
    return `=== DESTROY VS SEND TO GRAVEYARD ===
- "Destroy" is a specific form of removal.
  * Triggers effects that say "If this card is destroyed".
  * Blocked by destruction protection (e.g., "cannot be destroyed by card effects").
- "Send to the GY":
  * Bypasses ALL destruction protection!
  * Does NOT count as destruction (will not trigger "When/If this card is destroyed").
  * Example: Send to GY (Dingirsu, Zeus, S:P Little Knight) is much stronger removal than destruction.`;
  }

  if (normalized.includes('cost vs effect') || normalized.includes('colon') || normalized.includes('semicolon')) {
    return `=== COST VS EFFECT (PSCT COLON / SEMICOLON) ===
Format: "[Condition]: [Cost]; [Effect]"
- Text BEFORE the colon is the activation condition. It must be true to activate.
- Text BETWEEN colon and semicolon is the COST. It is paid at activation, before the chain link is created, and is never refunded if the effect is negated.
- Text AFTER the semicolon is the EFFECT. It resolves when the chain link resolves.
- If a card is negated (e.g. by Ash Blossom), the cost is still paid.
- "You can only use this effect once per turn" is consumed even if the effect is negated.`;
  }

  if (normalized.includes('summon') || normalized.includes('fusion') || normalized.includes('synchro') || normalized.includes('xyz') || normalized.includes('link') || normalized.includes('pendulum')) {
    return `=== SUMMONING MECHANICS ===
Normal Summon / Set: once per turn per player (not per card). Tribute Summon (Level 5-6 = 1 Tribute, Level 7+ = 2).
Special Summon: by card effect or by game mechanic (Fusion/Synchro/Xyz/Link/Pendulum).
- Fusion: needs a Fusion Summon effect (or a card that ignores it). Materials go to GY.
- Synchro: Tuner + non-Tuner(s); Levels must add up exactly to the Synchro Monster's Level.
- Xyz: 2+ monsters of the same Level; the Xyz Monster's Rank equals that Level; materials become Xyz Materials (not on field).
- Link: Link Materials' Link Ratings must equal the Link Monster's Link Rating; Link Monsters can be used as material (1 or their Link Rating). Link Arrows matter for co-linking.
- Pendulum: Pendulum Summon from hand/Extra Deck face-up; Scales determine Levels (exclusive).
Summon negation: "negate the Summon" removes the monster from the field and it is not considered successfully Summoned. "Negate the activation" of a Summon-negating card is different.
"Must first be Special Summoned by..." = cannot be Summoned by other means until properly Summoned once; after that it can be revived if it has no "must be" clause.`;
  }

  if (normalized.includes('spell speed') || normalized.includes('chain') || normalized.includes('priority')) {
    return `=== SPELL SPEEDS & CHAINS ===
Spell Speed 1: Normal/Equip/Continuous/Field/Ritual Spells, Ignition & Trigger monster effects. Cannot respond to Spell Speed 2+.
Spell Speed 2: Quick-Play Spells, Normal/Continuous Traps, Quick Effects. Can respond to Spell Speed 1/2.
Spell Speed 3: Counter Traps. Only Counter Traps can respond to Counter Traps.
Chain building: players alternate adding links; the last link resolves first (LIFO). A card/effect cannot be activated while a chain is resolving.
After a chain resolves, trigger effects that meet their conditions can start a new chain (SEGOC order if multiple).`;
  }

  if (normalized.includes('hopt') || normalized.includes('once per turn') || normalized.includes('sopt')) {
    return `=== HARD VS SOFT ONCE PER TURN ===
Soft once per turn ("once per turn" with no card-name clause): each COPY can use the effect once per turn. Two copies = two uses.
Hard once per turn ("You can only use this effect of 'X' once per turn"): the effect name is locked for the turn. Two copies = still only one use.
"Once per Duel" = hard limit for the entire Duel, not per turn.
In ocgcore Lua: SetCountLimit(1) = soft; SetCountLimit(1, id) = hard linked to the card's ID; SetCountLimit(1, id, EFFECT_COUNT_CODE_DUEL) = once per Duel.
If an effect is negated, the hard once-per-turn is still consumed (the activation happened).`;
  }

  if (normalized.includes('psct') || normalized.includes('problem solving')) {
    return `=== PSCT (PROBLEM-SOLVING CARD TEXT) ===
- "If" = the condition only needs to be true at activation/resolution; it does not miss timing.
- "When" = the trigger must be the last thing to happen; optional "When... you can" can miss timing.
- "You can" = optional effect. No "you can" = mandatory.
- "Target" = chosen at activation. No "target" = chosen at resolution (non-targeting).
- "Destroy" = destruction; "send to GY" and "banish" bypass destruction protection.
- "Negate the activation" vs "negate the effect": see the dedicated section.
- "And if you do" / "also" / "then": these words define whether the second action happens if the first fails.
- "Once per turn" vs "You can only use this effect... once per turn": soft vs hard.`;
  }

  if (normalized.includes('battle') || normalized.includes('replay') || normalized.includes('damage calculation')) {
    return `=== BATTLE PHASE & REPLAYS ===
Battle Phase steps: Start Step → Battle Step (attack declaration) → Damage Step → End Step.
Replay: if the number of monsters on the opponent's field changes during the Battle Step, the attack is replayed (attacker chooses a new attack target or the attack stops). A replay does NOT occur during the Damage Step.
Damage Step restrictions: see the dedicated Damage Step guide.
Direct attack: only if the opponent controls no monsters (or a card allows it).
Battle damage vs effect damage: different triggers and protections.`;
  }

  if (normalized.includes('floodgate') || normalized.includes('lock')) {
    return `=== FLOODGATES & LOCKS ===
Floodgates are continuous effects that restrict actions (e.g. Skill Drain, Imperial Order, Dimension Shifter, There Can Be Only One).
- They apply immediately when face-up (continuous effects do not start a chain).
- They can be removed by Spell/Trap removal or by negating the card's activation before it resolves.
- "Cannot activate" (e.g. Imperial Order) prevents activation entirely.
- "Negate the effect" (e.g. Skill Drain) allows activation but the effect resolves negated.
- Cost can still be paid if the card can activate.`;
  }

  // Default fallback covering general query
  return `=== YU-GI-OH! MECHANICS SUMMARY: ${term.toUpperCase()} ===
Topic not found in specialized index. Available topics to query:
- 'cost vs effect': Colons, semicolons, activation costs vs resolution effects.
- 'targeting': What targets vs what doesn't, activation vs resolution selection.
- 'missing timing': "When... you can" vs "If... you can" vs mandatory triggers.
- 'negate activation vs negate effect': Once-per-turn implications and damage step validity.
- 'banish vs gy': Dimension Shifter interactions and paying costs.
- 'destroy vs send': Removal types and protection bypass.
- 'summoning': Fusion/Synchro/Xyz/Link/Pendulum rules and summon negation.
- 'spell speed': Spell Speeds 1/2/3 and chain building.
- 'hopt': Hard vs soft once-per-turn.
- 'psct': Problem-Solving Card Text.
- 'battle': Battle Phase, replays and damage calculation.
- 'floodgate': Continuous locks and how to remove them.`;
}
