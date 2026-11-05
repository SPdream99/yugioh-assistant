export interface CardImage {
  id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

export interface BanlistInfo {
  ban_tcg?: string;
  ban_ocg?: string;
  ban_goat?: string;
  [key: string]: string | undefined;
}

export interface Card {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc: string;
  atk?: number;
  def?: number;
  level?: number;
  race?: string;
  attribute?: string;
  scale?: number;
  linkval?: number;
  linkmarkers?: string[];
  archetype?: string;
  card_sets?: any[];
  card_images?: { id: number; image_url: string; image_url_small: string; image_url_cropped: string }[];
  card_prices?: any[];
  banlist_info?: { ban_tcg?: string; ban_ocg?: string; ban_goat?: string };
}

export interface NumberRange {
  min?: number;
  max?: number;
}

export interface CardFilter {
  name?: string;
  type?: string;
  race?: string;
  attribute?: string;
  level?: number | { min?: number; max?: number };
  atk?: number | { min?: number; max?: number };
  def?: number | { min?: number; max?: number };
  archetype?: string;
  desc?: string;
  scale?: number | { min?: number; max?: number };
  linkval?: number | { min?: number; max?: number };
  format?: string;
  banlist?: string;
}

export type { DeckData, ResolvedDeck } from './deck.js';

