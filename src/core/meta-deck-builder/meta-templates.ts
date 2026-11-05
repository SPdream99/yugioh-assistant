import type { DeckData } from "../../types/deck.js";

export interface ArchetypeCard {
  id: number;
  name: string;
  copies: number;
}

export interface ArchetypeTemplate {
  name: string;
  style: string;
  strategy: string;
  tier: 1 | 2;
  coreMain: ArchetypeCard[];
  coreExtra: ArchetypeCard[];
  recommendedSide?: ArchetypeCard[];
}

export const META_TEMPLATES: Record<string, ArchetypeTemplate> = {
  "Maliss": {
    name: "Maliss",
    style: "Cyberse Banish Combo / Midrange",
    strategy: "Top 2025/2026 meta deck utilizing Maliss <P> White Rabbit, Dormouse, and Chessy Cat to banish and special summon from banish, searching traps directly to set and activate turn 1 via Maliss in Underground and Red Ransom.",
    tier: 1,
    coreMain: [
      { id: 69272449, name: "Maliss <P> White Rabbit", copies: 3 },
      { id: 32061192, name: "Maliss <P> Dormouse", copies: 3 },
      { id: 96676583, name: "Maliss <P> Chessy Cat", copies: 3 },
      { id: 20938824, name: "Maliss <P> March Hare", copies: 2 },
      { id: 68337209, name: "Maliss in Underground", copies: 3 },
      { id: 93453053, name: "Maliss in the Mirror", copies: 1 },
      { id: 94722358, name: "Maliss <C> MTP-07", copies: 3 },
      { id: 20726052, name: "Maliss <C> GWC-06", copies: 2 },
      { id: 57111661, name: "Maliss <C> TB-11", copies: 1 },
      { id: 57421866, name: "Cynet Mining", copies: 3 },
      { id: 91800273, name: "Dimension Shifter", copies: 2 }
    ],
    coreExtra: [
      { id: 68059897, name: "Maliss <Q> Red Ransom", copies: 2 },
      { id: 95454996, name: "Maliss <Q> White Binder", copies: 2 },
      { id: 21848500, name: "Maliss <Q> Hearts Crypter", copies: 2 },
      { id: 29301450, name: "S:P Little Knight", copies: 1 },
      { id: 65741786, name: "I:P Masquerena", copies: 1 },
      { id: 86066372, name: "Accesscode Talker", copies: 1 },
      { id: 73580471, name: "Promethean Princess", copies: 1 },
      { id: 34334692, name: "Moon of the Closed Sky", copies: 1 },
      { id: 83965310, name: "Super Starslayer TY-PHON", copies: 1 }
    ],
    recommendedSide: [
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 24299458, name: "Forbidden Droplet", copies: 3 },
      { id: 18144506, name: "Harpie's Feather Duster", copies: 1 },
      { id: 88453933, name: "Triple Tactics Thrust", copies: 3 },
      { id: 27204311, name: "Nibiru, the Primal Being", copies: 2 }
    ]
  },

  "Centur-Ion": {
    name: "Centur-Ion",
    style: "Continuous Trap Synchro Acceleration",
    strategy: "Places Centur-Ion Primera and Trudea in Spell/Trap zones, quick-synchros on opponent's turn into Level 12 boss monsters: Centur-Ion Legatia, Auxila, and Cosmic Blazar Dragon.",
    tier: 1,
    coreMain: [
      { id: 15005145, name: "Centur-Ion Primera", copies: 3 },
      { id: 42493140, name: "Centur-Ion Trudea", copies: 3 },
      { id: 97698279, name: "Centur-Ion Gargoyle II", copies: 2 },
      { id: 96030710, name: "Centur-Ion Atrii", copies: 2 },
      { id: 78888899, name: "Centur-Ion Emeth VI", copies: 1 },
      { id: 41371602, name: "Stand Up Centur-Ion!", copies: 3 },
      { id: 77765207, name: "Emblema Oath", copies: 3 },
      { id: 4160316, name: "Centur-Ion Bonds", copies: 1 },
      { id: 40155014, name: "Centur-Ion Phalanx", copies: 2 },
      { id: 77543769, name: "Centur-Ion True Awakening", copies: 1 },
      { id: 73628505, name: "Terraforming", copies: 1 }
    ],
    coreExtra: [
      { id: 15982593, name: "Centur-Ion Legatia", copies: 2 },
      { id: 71858682, name: "Centur-Ion Auxila", copies: 2 },
      { id: 8841431, name: "Centur-Ion Primera Primus", copies: 1 },
      { id: 35952884, name: "Cosmic Blazar Dragon", copies: 1 },
      { id: 29301450, name: "S:P Little Knight", copies: 1 },
      { id: 83965310, name: "Super Starslayer TY-PHON", copies: 1 },
      { id: 90448279, name: "Divine Arsenal AA-ZEUS", copies: 1 },
      { id: 62991886, name: "Chaos Angel", copies: 1 },
      { id: 86066372, name: "Accesscode Talker", copies: 1 }
    ],
    recommendedSide: [
      { id: 94145021, name: "Droll & Lock Bird", copies: 3 },
      { id: 24299458, name: "Forbidden Droplet", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 18144506, name: "Harpie's Feather Duster", copies: 1 },
      { id: 27204311, name: "Nibiru", copies: 2 }
    ]
  },

  "Voiceless Voice": {
    name: "Voiceless Voice",
    style: "LIGHT Ritual Omni-Negate & Protection",
    strategy: "Lo, the Prayers of the Voiceless Voice continually recurs from GY, providing continuous target/destruction protection to LIGHT monsters while Skull Guardian delivers spell/trap/monster negates.",
    tier: 1,
    coreMain: [
      { id: 25801745, name: "Lo, the Prayers of the Voiceless Voice", copies: 3 },
      { id: 51296484, name: "Saffira, Dragon Queen of the Voiceless Voice", copies: 3 },
      { id: 88284599, name: "Sauravis, Dragon Sage of the Voiceless Voice", copies: 2 },
      { id: 10804018, name: "Saffira, Divine Dragon of the Voiceless Voice", copies: 2 },
      { id: 98477480, name: "Barrier of the Voiceless Voice", copies: 3 },
      { id: 52472775, name: "Prayers of the Voiceless Voice", copies: 2 },
      { id: 86310763, name: "Radiance of the Voiceless Voice", copies: 2 },
      { id: 39114494, name: "Blessing of the Voiceless Voice", copies: 1 }
    ],
    coreExtra: [
      { id: 29301450, name: "S:P Little Knight", copies: 1 },
      { id: 65741786, name: "I:P Masquerena", copies: 1 },
      { id: 62991886, name: "Chaos Angel", copies: 1 },
      { id: 83965310, name: "Super Starslayer TY-PHON", copies: 1 },
      { id: 90448279, name: "Divine Arsenal AA-ZEUS", copies: 1 },
      { id: 54757758, name: "Mudragon of the Swamp", copies: 1 },
      { id: 11765832, name: "Garura, Wings of Resonant Life", copies: 1 }
    ],
    recommendedSide: [
      { id: 94145021, name: "Droll & Lock Bird", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 24224830, name: "Called by the Grave", copies: 1 },
      { id: 18144506, name: "Harpie's Feather Duster", copies: 1 }
    ]
  },

  "White Forest": {
    name: "White Forest",
    style: "Synchro / Illusion Combo",
    strategy: "Sends Spells/Traps from hand or field to trigger Astellar and Elzette, synchro climbing into Diabell and Silvera while recurring resources from GY.",
    tier: 1,
    coreMain: [
      { id: 25592142, name: "Astellar of the White Forest", copies: 3 },
      { id: 61980241, name: "Elzette of the White Forest", copies: 3 },
      { id: 98385955, name: "Silvy of the White Forest", copies: 3 },
      { id: 24779554, name: "Rucia of the White Forest", copies: 2 },
      { id: 99289828, name: "Tales of the White Forest", copies: 3 },
      { id: 35778533, name: "Beware the White Forest", copies: 2 },
      { id: 62995268, name: "Woes of the White Forest", copies: 2 },
      { id: 93723936, name: "Scourge of the White Forest", copies: 1 }
    ],
    coreExtra: [
      { id: 14307929, name: "Diabell, Queen of the White Forest", copies: 2 },
      { id: 41924516, name: "Silvera, Wolf Tamer of the White Forest", copies: 2 },
      { id: 77313225, name: "Rciela, Sinister Soul of the White Forest", copies: 2 },
      { id: 29301450, name: "S:P Little Knight", copies: 1 },
      { id: 65741786, name: "I:P Masquerena", copies: 1 },
      { id: 83965310, name: "Super Starslayer TY-PHON", copies: 1 },
      { id: 62991886, name: "Chaos Angel", copies: 1 }
    ],
    recommendedSide: [
      { id: 94145021, name: "Droll & Lock Bird", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 24299458, name: "Forbidden Droplet", copies: 3 }
    ]
  },

  "Yubel": {
    name: "Yubel",
    style: "Fiend Destruction & Fusion",
    strategy: "Destroys Yubel monsters via Samsara D Lotus and Nightmare Throne to trigger float effects, summon Phantom of Yubel, and punish opponent attacks with 0 ATK battle damage reflection.",
    tier: 1,
    coreMain: [
      { id: 90829280, name: "Spirit of Yubel", copies: 3 },
      { id: 62318994, name: "Samsara D Lotus", copies: 3 },
      { id: 93729896, name: "Nightmare Throne", copies: 3 },
      { id: 65261141, name: "Nightmare Pain", copies: 3 },
      { id: 78371393, name: "Yubel", copies: 1 },
      { id: 4779091, name: "Yubel - Terror Incarnate", copies: 1 },
      { id: 73628505, name: "Terraforming", copies: 1 },
      { id: 48130397, name: "Super Polymerization", copies: 3 }
    ],
    coreExtra: [
      { id: 80453041, name: "Phantom of Yubel", copies: 3 },
      { id: 51296484, name: "Yubel - The Loving Defender Forever", copies: 2 },
      { id: 29301450, name: "S:P Little Knight", copies: 1 },
      { id: 65741786, name: "I:P Masquerena", copies: 1 },
      { id: 83965310, name: "Super Starslayer TY-PHON", copies: 1 },
      { id: 54757758, name: "Mudragon of the Swamp", copies: 1 },
      { id: 11765832, name: "Garura, Wings of Resonant Life", copies: 1 },
      { id: 41209827, name: "Starving Venom Fusion Dragon", copies: 1 }
    ],
    recommendedSide: [
      { id: 91800273, name: "Dimension Shifter", copies: 2 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 24299458, name: "Forbidden Droplet", copies: 3 }
    ]
  },

  "Tenpai Dragon": {
    name: "Tenpai Dragon",
    style: "Going 2nd OTK (Limit Regulation Compliant)",
    strategy: "Heavy board breakers, rapid battle phase Synchro climb into Bident Dragion and Trident Dragion for lethal damage, strictly conforming to current limit regulations.",
    tier: 2,
    coreMain: [
      { id: 99539075, name: "Tenpai Dragon Paidra", copies: 3 },
      { id: 72145330, name: "Tenpai Dragon Chundra", copies: 3 },
      { id: 46849495, name: "Tenpai Dragon Fadra", copies: 3 },
      { id: 85272661, name: "Sangen Kaimen", copies: 3 },
      { id: 21183353, name: "Sangen Summoning", copies: 1 }, // Compliant with limit regulations
      { id: 73628505, name: "Terraforming", copies: 1 }
    ],
    coreExtra: [
      { id: 82570174, name: "Sangenpai Bident Dragion", copies: 2 },
      { id: 18969888, name: "Sangenpai Transcendent Dragion", copies: 2 },
      { id: 39402797, name: "Trident Dragion", copies: 1 },
      { id: 87837090, name: "Kuibelt the Blade Dragon", copies: 1 },
      { id: 33698022, name: "Black Rose Moonlight Dragon", copies: 1 },
      { id: 66403530, name: "Striker Dragon", copies: 1 },
      { id: 9822220, name: "Hieratic Seal of the Heavenly Spheres", copies: 1 },
      { id: 29301450, name: "S:P Little Knight", copies: 1 },
      { id: 73580471, name: "Promethean Princess", copies: 1 },
      { id: 83965310, name: "Super Starslayer TY-PHON", copies: 1 },
      { id: 65741786, name: "I:P Masquerena", copies: 1 },
      { id: 86066372, name: "Accesscode Talker", copies: 1 },
      { id: 90448279, name: "Divine Arsenal AA-ZEUS", copies: 1 }
    ],
    recommendedSide: [
      { id: 91800273, name: "Dimension Shifter", copies: 2 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 94145021, name: "Droll & Lock Bird", copies: 3 },
      { id: 27204311, name: "Nibiru, the Primal Being", copies: 2 },
      { id: 18144506, name: "Harpie's Feather Duster", copies: 1 }
    ]
  },

  "Branded Despia": {
    name: "Branded Despia",
    style: "Midrange Fusion (Current Banlist Compliant)",
    strategy: "Recursive Fusion loop utilizing Fallen of Albaz, Aluber, and Mirrorjade, strictly conforming to current limit regulations without banned extenders.",
    tier: 2,
    coreMain: [
      { id: 32603893, name: "Fallen of Albaz", copies: 3 },
      { id: 61245789, name: "Aluber the Jester of Despia", copies: 3 },
      { id: 44146295, name: "Branded Fusion", copies: 1 }, // Strictly Limited
      { id: 78942511, name: "Branded Opening", copies: 3 },
      { id: 95515789, name: "Blazing Cartesia", copies: 2 },
      { id: 45883110, name: "Guiding Quem", copies: 2 },
      { id: 19096726, name: "Tri-Brigade Mercourier", copies: 1 },
      { id: 38668704, name: "Despian Tragedy", copies: 2 },
      { id: 4064256, name: "Fairy Tail - Snow", copies: 1 }
    ],
    coreExtra: [
      { id: 44097050, name: "Mirrorjade the Iceblade Dragon", copies: 2 },
      { id: 8730435, name: "Albion the Branded Dragon", copies: 2 },
      { id: 49814180, name: "Lubellion the Searing Dragon", copies: 1 },
      { id: 74997493, name: "Granguignol the Dusk Dragon", copies: 2 },
      { id: 51409648, name: "Rindbrumm the Striking Dragon", copies: 1 },
      { id: 38811586, name: "Albion the Sanctifire Dragon", copies: 1 },
      { id: 10002346, name: "Guardian Chimera", copies: 1 },
      { id: 54757758, name: "Mudragon of the Swamp", copies: 1 },
      { id: 11765832, name: "Garura, Wings of Resonant Life", copies: 1 },
      { id: 41209827, name: "Starving Venom Fusion Dragon", copies: 1 },
      { id: 29301450, name: "S:P Little Knight", copies: 1 }
    ],
    recommendedSide: [
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 24299458, name: "Forbidden Droplet", copies: 3 },
      { id: 94145021, name: "Droll & Lock Bird", copies: 3 },
      { id: 18144506, name: "Harpie's Feather Duster", copies: 1 },
      { id: 24224830, name: "Called by the Grave", copies: 1 }
    ]
  },

  "Light and Darkness Ritual": {
    name: "Light and Darkness Ritual",
    style: "Chaos Ritual Swarm & Disruption (RoLaD)",
    strategy: "Recursive Ritual loop utilizing Light and Darkness Ritual (RoLaD) to summon Black Luster Soldier - Soldier of Light and Darkness and Magician of Dark Chaos. Uses Celtic Mystic for draw power and Chaos Magical Hats / Mind Shuffle for interactive disruption.",
    tier: 1,
    coreMain: [
      { id: 70405001, name: "Black Luster Soldier - Soldier of Light and Darkness", copies: 2 },
      { id: 44001993, name: "Magician of Dark Chaos - Black Chaos", copies: 2 },
      { id: 33599853, name: "Light and Darkness Ritual", copies: 3 },
      { id: 50073633, name: "Celtic Mystic", copies: 3 },
      { id: 98684220, name: "Black Chaos", copies: 2 },
      { id: 97462632, name: "Griffoh", copies: 3 },
      { id: 24088928, name: "Skull Archfiend of Chaos", copies: 2 },
      { id: 2372506, name: "Chaos Magical Hats", copies: 2 },
      { id: 24749710, name: "Mind Shuffle", copies: 2 },
      { id: 75983808, name: "Chaos Mystic Box", copies: 1 },
      { id: 77456448, name: "Spell Shattering Sword", copies: 1 },
      { id: 13048472, name: "Pre-Preparation of Rites", copies: 3 },
      { id: 96729612, name: "Preparation of Rites", copies: 2 }
    ],
    coreExtra: [
      { id: 29301450, name: "S:P Little Knight", copies: 2 },
      { id: 73898890, name: "Dyna Mondo", copies: 2 },
      { id: 22850702, name: "Chaos Angel", copies: 1 },
      { id: 79606837, name: "Herald of the Arc Light", copies: 2 },
      { id: 65741786, name: "I:P Masquerena", copies: 1 },
      { id: 93039339, name: "Super Starslayer TY-PHON - Sky Crisis", copies: 1 },
      { id: 86066372, name: "Accesscode Talker", copies: 1 },
      { id: 54757758, name: "Mudragon of the Swamp", copies: 1 },
      { id: 11765832, name: "Garura, Wings of Resonant Life", copies: 1 }
    ],
    recommendedSide: [
      { id: 91800273, name: "Dimension Shifter", copies: 2 },
      { id: 24299458, name: "Forbidden Droplet", copies: 3 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 18144506, name: "Harpie's Feather Duster", copies: 1 },
      { id: 24224830, name: "Called by the Grave", copies: 1 }
    ]
  },

  "Elfnote": {
    name: "Elfnote",
    style: "Synchro & Fusion Acceleration Swarm",
    strategy: "Top 2026 meta deck utilizing Elfnote June Pride, Lucina, and Regina to accelerate Synchro Tuner climbs into Seraphim Strelitzia while looping spells via Quatrain of Succession.",
    tier: 1,
    coreMain: [
      { id: 5559570, name: "Elfnote June Pride", copies: 3 },
      { id: 13597785, name: "Elfnote Lucina", copies: 3 },
      { id: 56651978, name: "Elfnote Regina", copies: 3 },
      { id: 59581480, name: "Elfnote Tinia", copies: 2 },
      { id: 58809685, name: "Elfnotes: Quatrain of Succession", copies: 3 },
      { id: 90880453, name: "Elfnotes: A Plea for Help", copies: 2 },
      { id: 50590801, name: "Elfnotes: Aristeia of Trust", copies: 2 }
    ],
    coreExtra: [
      { id: 42302563, name: "Elfnote Seraphim Strelitzia", copies: 2 },
      { id: 29301450, name: "S:P Little Knight", copies: 2 },
      { id: 65741786, name: "I:P Masquerena", copies: 1 },
      { id: 22850702, name: "Chaos Angel", copies: 1 },
      { id: 93039339, name: "Super Starslayer TY-PHON - Sky Crisis", copies: 1 },
      { id: 86066372, name: "Accesscode Talker", copies: 1 }
    ],
    recommendedSide: [
      { id: 24299458, name: "Forbidden Droplet", copies: 3 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 91800273, name: "Dimension Shifter", copies: 2 },
      { id: 18144506, name: "Harpie's Feather Duster", copies: 1 },
      { id: 24224830, name: "Called by the Grave", copies: 1 }
    ]
  },

  "Angelechy": {
    name: "Angelechy",
    style: "Chess Tactical Control & Board Lock",
    strategy: "Tactical positional control archetype utilizing Angelechy Bastion and Shatranga, setting tactical chess traps like Opening to e4 and Problem to restrict opponent movement and zone options.",
    tier: 1,
    coreMain: [
      { id: 28904860, name: "Angelechy Bastion", copies: 3 },
      { id: 42410161, name: "Angelechy Shatranga", copies: 3 },
      { id: 55393975, name: "Angelechy Destrier", copies: 3 },
      { id: 50284408, name: "Angelechy Castellan", copies: 2 },
      { id: 80565021, name: "Angelechy Opening to e4", copies: 3 },
      { id: 17782288, name: "Angelechy Problem", copies: 2 },
      { id: 54171327, name: "Angelechy Disturbance", copies: 2 },
      { id: 13068112, name: "Angelechy Strategy Score", copies: 2 }
    ],
    coreExtra: [
      { id: 81797573, name: "Angelechy Enlisted", copies: 2 },
      { id: 29301450, name: "S:P Little Knight", copies: 2 },
      { id: 65741786, name: "I:P Masquerena", copies: 1 },
      { id: 93039339, name: "Super Starslayer TY-PHON - Sky Crisis", copies: 1 },
      { id: 90448279, name: "Divine Arsenal AA-ZEUS - Sky Thunder", copies: 1 }
    ],
    recommendedSide: [
      { id: 24299458, name: "Forbidden Droplet", copies: 3 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 94145021, name: "Droll & Lock Bird", copies: 3 },
      { id: 18144506, name: "Harpie's Feather Duster", copies: 1 }
    ]
  },

  "Raise Moon": {
    name: "Raise Moon",
    style: "Casino Xyz & Gambler Control",
    strategy: "Deck Build Pack powerhouse utilizing \"Raise Moon\" the City that Never Sleeps to protect Level 7 monsters and cycle resources. Summons Cielo - No More Bets! and Hope Squeeze - Jackpot for high-stakes card advantage.",
    tier: 1,
    coreMain: [
      { id: 72978038, name: "\"Raise Moon\" the City that Never Sleeps", copies: 3 },
      { id: 75934716, name: "Cielo, the Veil of Raise Moon", copies: 3 },
      { id: 47605577, name: "Raise Moon Starter Squeeze", copies: 3 },
      { id: 74212164, name: "Raise Moon Blade Shayna", copies: 3 },
      { id: 11333460, name: "Raise Moon Elegance Carol", copies: 2 },
      { id: 10611873, name: "Raise Moon Lamp Croucier", copies: 2 },
      { id: 46983930, name: "The Stars of Raise Moon", copies: 3 },
      { id: 9362643, name: "The Glitter of Raise Moon", copies: 2 }
    ],
    coreExtra: [
      { id: 73090586, name: "Cielo, the Night Sky of Raise Moon - No More Bets!", copies: 2 },
      { id: 9484285, name: "Raise Moon Hope Squeeze - Jackpot", copies: 2 },
      { id: 29301450, name: "S:P Little Knight", copies: 2 },
      { id: 93039339, name: "Super Starslayer TY-PHON - Sky Crisis", copies: 1 },
      { id: 90448279, name: "Divine Arsenal AA-ZEUS - Sky Thunder", copies: 1 }
    ],
    recommendedSide: [
      { id: 24299458, name: "Forbidden Droplet", copies: 3 },
      { id: 15693423, name: "Evenly Matched", copies: 3 },
      { id: 86327225, name: "Dark Ruler No More", copies: 3 },
      { id: 91800273, name: "Dimension Shifter", copies: 2 },
      { id: 24224830, name: "Called by the Grave", copies: 1 }
    ]
  }
};

export const META_ARCHETYPES = META_TEMPLATES;

export function getArchetypeTemplate(name: string): ArchetypeTemplate | undefined {
  const normalized = name.trim().toLowerCase();
  if (normalized === "rolad" || normalized === "ritual of light and darkness" || normalized.includes("light and darkness ritual")) {
    return META_TEMPLATES["Light and Darkness Ritual"];
  }
  for (const [key, template] of Object.entries(META_TEMPLATES)) {
    if (key.toLowerCase() === normalized || template.name.toLowerCase() === normalized) {
      return template;
    }
  }
  for (const [key, template] of Object.entries(META_TEMPLATES)) {
    if (normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized)) {
      return template;
    }
  }
  return undefined;
}
