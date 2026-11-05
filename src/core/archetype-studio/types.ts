export type SimulatorProfile = 'omega' | 'edopro' | 'generic';

export interface MasterCardData {
  id: number;
  name: string;
  type: string;
  attribute?: string;
  race?: string;
  level?: number;
  atk?: number;
  def?: number;
  scale?: number;
  linkMarkers?: string[];
  /** Numeric link marker bitmask (Top=1, Bottom=2, Left=4, Right=8, TopLeft=16, TopRight=32, BottomLeft=64, BottomRight=128). */
  linkmarkers?: number;
  desc: string;
  strings?: string[]; // str1 to str16 for aux.Stringid
  visualPrompt?: string;
  effectsSpec?: any[];
  /** Full ocgcore Lua script. When present it is used verbatim instead of the stub generator. */
  lua?: string;
}

export interface ArtStyleOptions {
  style?: string;
  palette?: string;
  model?: string;
  aspectRatio?: string;
}

export interface ArchetypeMasterSpec {
  archetypeName: string;
  setcode: string; // e.g. "0x99f" or "0x2a1"
  lore: string;
  playstyle: string;
  targetSimulator: SimulatorProfile;
  author?: string;
  createdAt?: string;
  cards: MasterCardData[];
}

export interface ValidationIssue {
  cardId?: number;
  cardName?: string;
  field?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface DocxValidationResult {
  valid: boolean;
  archetypeName: string;
  setcode: string;
  targetSimulator: SimulatorProfile;
  cardCount: number;
  errors: string[];
  warnings: string[];
  issues: ValidationIssue[];
  cards: MasterCardData[];
}

export interface DatabaseAndScriptExportResult {
  success: boolean;
  databasePath: string;
  scriptsDir: string;
  simulatorProfile: SimulatorProfile;
  cardsCompiled: number;
  scriptsGenerated: string[];
  message: string;
}

export interface ArtPromptsExportResult {
  markdownPath: string;
  masterGridPrompt: string;
  individualPromptsCount: number;
  gridLayout: '2x2' | '3x3' | '4x4';
}

export interface GridSliceResult {
  success: boolean;
  sourceImage: string;
  outputDir: string;
  slicedCount: number;
  cardsOutput: { cardId: number; cardName: string; imagePath: string }[];
  message: string;
}

export interface FullPipelineResult {
  success: boolean;
  docxPath: string;
  spec: ArchetypeMasterSpec;
  validation: DocxValidationResult;
  databaseExport: DatabaseAndScriptExportResult;
  artPromptsExport: ArtPromptsExportResult;
  artSliceExport?: GridSliceResult;
  message: string;
}
