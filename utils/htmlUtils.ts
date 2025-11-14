/**
 * Shared HTML utilities for rendering summaries
 */

/**
 * Renders markdown-style links in overview text
 */
export const renderOverview = (text: string): string => {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const hash = url.split('/').pop() ?? '';
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-sky-500 hover:text-sky-300 font-mono">(${hash.substring(0, 7)})</a>`;
  });
};

/**
 * Renders point text with markdown formatting
 */
export const renderPointText = (text: string): string => {
  return text
    .replace(/\*\*BREAKING CHANGE\*\*/g, `<strong class="text-red-400 font-bold">BREAKING CHANGE</strong>`)
    .replace(/`([^`]+)`/g, `<code class="bg-gray-700 text-pink-400 rounded px-2 py-1 text-sm font-mono">$1</code>`);
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
