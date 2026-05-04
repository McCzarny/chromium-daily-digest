/**
 * Shared HTML utilities for rendering summaries
 */

/**
 * Palette of Tailwind CSS color triplets for component badges.
 * Colors are picked deterministically from this list based on a string hash,
 * so any component name — including future ones — automatically gets a stable color.
 */
const BADGE_PALETTE = [
  'bg-purple-900 text-purple-200 border-purple-700',
  'bg-violet-900 text-violet-200 border-violet-700',
  'bg-indigo-900 text-indigo-200 border-indigo-700',
  'bg-blue-900 text-blue-200 border-blue-700',
  'bg-sky-900 text-sky-200 border-sky-700',
  'bg-teal-900 text-teal-200 border-teal-700',
  'bg-cyan-900 text-cyan-200 border-cyan-700',
  'bg-emerald-900 text-emerald-200 border-emerald-700',
  'bg-green-900 text-green-200 border-green-700',
  'bg-lime-900 text-lime-200 border-lime-700',
  'bg-yellow-900 text-yellow-200 border-yellow-700',
  'bg-amber-900 text-amber-200 border-amber-700',
  'bg-orange-900 text-orange-200 border-orange-700',
  'bg-red-900 text-red-200 border-red-700',
  'bg-rose-900 text-rose-200 border-rose-700',
  'bg-pink-900 text-pink-200 border-pink-700',
  'bg-fuchsia-900 text-fuchsia-200 border-fuchsia-700',
  'bg-slate-700 text-slate-200 border-slate-500',
  'bg-zinc-700 text-zinc-200 border-zinc-500',
  'bg-stone-700 text-stone-200 border-stone-500',
];

/** Simple djb2-style hash that maps a string to a non-negative integer. */
const hashString = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0; // unsigned 32-bit
};

const getComponentColor = (component: string): string =>
  BADGE_PALETTE[hashString(component) % BADGE_PALETTE.length];

/**
 * Renders component tags as colored badges.
 * Color is derived from the component name, so any string works without
 * maintaining a lookup table.
 */
export const renderComponentBadges = (components?: string[]): string => {
  if (!components || components.length === 0) return '';
  return components.map(component => {
    const colorClasses = getComponentColor(component);
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorClasses} mr-1">${component}</span>`;
  }).join('');
};

/**
 * Escapes HTML special characters to prevent HTML injection
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Renders markdown-style links and code formatting in overview text
 */
export const renderOverview = (text: string): string => {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
      const hash = url.split('/').pop() ?? '';
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-sky-500 hover:text-sky-300 font-mono">(${hash.substring(0, 7)})</a>`;
    })
    .replace(/`([^`]+)`/g, (match, code) => {
      return `<code class="bg-gray-700 text-pink-400 rounded px-2 py-1 text-sm font-mono">${escapeHtml(code)}</code>`;
    })
    .replace(/(<(?:a|code)\b[^>]*>[\s\S]*?<\/(?:a|code)>|<[^>]+>)|\b([a-f0-9]{7,40})\b/g, (match, htmlElement, hash) => {
      if (htmlElement !== undefined) return htmlElement;
      return `<a href="${GITHUB_COMMIT_URL}${hash}" target="_blank" rel="noopener noreferrer" class="text-sky-500 hover:text-sky-300 font-mono">(${hash.substring(0, 7)})</a>`;
    });
};

/**
 * Renders point text with markdown formatting
 */
export const renderPointText = (text: string): string => {
  return text
    // Sometime LLM returns needless BREAKING CHANGE marker
    .replace(/^\*\*BREAKING( CHANGE)?:\*\*:\s*/, '')
    .replace(/\*\*([^\*]+)\*\*/g, (match, boldText) => `<strong class="text-red-400 font-bold">${escapeHtml(boldText)}</strong>`)
    .replace(/`([^`]+)`/g, (match, code) => {
      return `<code class="bg-gray-700 text-pink-400 rounded px-2 py-1 text-sm font-mono">${escapeHtml(code)}</code>`;
    });
};

/**
 * Calculate relative path to assets folder based on subdirectory depth
 */
export const getAssetsPath = (outputSubpath: string, assetName: string): string => {
  const depth = outputSubpath ? outputSubpath.split('/').filter(p => p).length : 0;
  const prefix = depth > 0 ? '../'.repeat(depth) : '';
  return `${prefix}assets/${assetName}`;
};

/**
 * GitHub commit URL base
 */
export const GITHUB_COMMIT_URL = 'https://github.com/chromium/chromium/commit/';
