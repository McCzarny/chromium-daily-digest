/**
 * Shared HTML utilities for rendering summaries
 */

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
    .replace(/\b([a-f0-9]{7,40})\b/g, (match, hash) => {
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
