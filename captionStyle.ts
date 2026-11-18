/** Caption style registry: bundled OFL fonts + colour handling for subtitles/headlines. */
import path from 'path';
import { fileURLToPath } from 'url';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fonts');

export interface FontDef { key: string; label: string; family: string; file: string; bold: boolean; subFamily?: string; subFile?: string }

export const FONTS: Record<string, FontDef> = {
  inter: { key: 'inter', label: 'Inter', family: 'Inter ExtraBold', file: 'Inter-ExtraBold.ttf', bold: true, subFamily: 'Inter', subFile: 'Inter-Bold.ttf' },
  montserrat: { key: 'montserrat', label: 'Montserrat', family: 'nind Montserrat', file: 'Montserrat-ExtraBold.ttf', bold: false },
  roboto: { key: 'roboto', label: 'Roboto', family: 'nind Roboto', file: 'Roboto-Black.ttf', bold: false },
  oswald: { key: 'oswald', label: 'Oswald', family: 'nind Oswald', file: 'Oswald-Bold.ttf', bold: false },
  bebas: { key: 'bebas', label: 'Bebas Neue', family: 'nind Bebas', file: 'BebasNeue-Regular.ttf', bold: false },
  playfair: { key: 'playfair', label: 'Playfair Display', family: 'nind Playfair', file: 'PlayfairDisplay-Bold.ttf', bold: false },
  anton: { key: 'anton', label: 'Anton', family: 'nind Anton', file: 'Anton-Regular.ttf', bold: false },
};

export function fontKey(name?: string | null): string | null {
  if (!name) return null;
  const n = String(name).toLowerCase().replace(/[^a-z]/g, '');
  if (!n) return null;
  for (const f of Object.values(FONTS)) {
    const l = f.label.toLowerCase().replace(/[^a-z]/g, '');
    if (n === f.key || n === l || l.startsWith(n) || n.startsWith(f.key)) return f.key;
  }
  if (/sf|sanfrancisco|helvetica|arial|system/.test(n)) return 'inter';
  if (/serif|times|georgia|elegant/.test(n)) return 'playfair';
  if (/condensed|impact|tall/.test(n)) return 'anton';
  return null;
}

const NAMED_COLORS: Record<string, string> = {
  white: '#FFFFFF', black: '#111111', blue: '#0F7DFE', red: '#FF3B30', green: '#34C759', yellow: '#FFD60A',
  orange: '#FF9500', purple: '#AF52DE', pink: '#FF2D55', violet: '#8B5CF6', cyan: '#32D7FF', lime: '#A3E635',
  gold: '#FFC300', gray: '#8E8E93', grey: '#8E8E93',
  'белый': '#FFFFFF', 'черный': '#111111', 'чёрный': '#111111', 'синий': '#0F7DFE', 'голубой': '#32ADE6', 'красный': '#FF3B30',
  'зеленый': '#34C759', 'зелёный': '#34C759', 'желтый': '#FFD60A', 'жёлтый': '#FFD60A', 'оранжевый': '#FF9500',
  'фиолетовый': '#AF52DE', 'розовый': '#FF2D55',
};

export function normColor(c?: string | null): string | null {
  if (!c) return null;
  const s = String(c).trim().toLowerCase();
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];
  if (s === '#0000ff' || s === '0000ff') return '#0F7DFE'; // plain "blue" -> brand blue
  const m = s.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (m) return '#' + (m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]).toUpperCase();
  return null;
}

export interface CaptionStyle {
  subtitle_font?: string; headline_font?: string;
  highlight_color?: string; subtitle_color?: string; headline_color?: string;
  subtitles?: boolean; headlines?: boolean; sub_scale?: number; head_scale?: number;
}

export const DEFAULT_STYLE: CaptionStyle = { subtitle_font: 'inter', headline_font: 'inter', highlight_color: '#FFFFFF', subtitle_color: '#FFFFFF', headline_color: '#FFFFFF', subtitles: true, headlines: true };

/** Convert the stored style into what tools/media_helper.py `ass` expects. */
export function styleSpec(st: CaptionStyle = {}) {
  const s = { ...DEFAULT_STYLE, ...st };
  const sub = FONTS[s.subtitle_font || 'inter'] || FONTS.inter;
  const head = FONTS[s.headline_font || 'inter'] || FONTS.inter;
  return {
    sub_font_file: path.join(FONT_DIR, sub.subFile || sub.file), sub_font_family: sub.subFamily || sub.family, sub_bold: sub.subFile ? true : sub.bold,
    head_font_file: path.join(FONT_DIR, head.file), head_font_family: head.family, head_bold: head.bold,
    highlight_color: s.highlight_color, subtitle_color: s.subtitle_color, headline_color: s.headline_color,
    subtitles: s.subtitles !== false, headlines: s.headlines !== false,
    sub_scale: Math.max(0.6, Math.min(1.6, Number(s.sub_scale) || 1)), head_scale: Math.max(0.6, Math.min(1.4, Number(s.head_scale) || 1)),
  };
}
