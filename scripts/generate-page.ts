import { fetchCommitsForDate } from '../services/chromiumService';
import { createLLMService } from '../services/llmService';
import { GitilesCommit, StructuredSummary, SummaryConfig } from '../types';
import { loadConfig, getIgnoredBotEmails } from '../config';
import { renderOverview, renderPointText, renderComponentBadges, getAssetsPath, GITHUB_COMMIT_URL } from '../utils/htmlUtils';
import fs from 'fs/promises';
import path from 'path';

const createHtmlPage = (
  summary: StructuredSummary, 
  allCommits: GitilesCommit[], 
  filteredCommits: GitilesCommit[], 
  date: string, 
  branch: string,
  outputSubpath: string
): string => {
  const assetsPath = getAssetsPath(outputSubpath, 'daily-digest-logo.svg');
  const modelUsed = summary.modelUsed || 'Unknown model';
  const escapedModelUsed = modelUsed.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Log summary whole summary for debugging
  // console.log('Generated Structured Summary:', JSON.stringify(summary, null, 2));

  const categoriesHtml = summary.categories.map((category, catIdx) => `
    <div>
      <h3 class="text-2xl font-semibold text-sky-400 mt-6 mb-4">${category.title}</h3>
      <ul class="list-disc list-inside space-y-3">
        ${category.points.map((point, pointIdx) => {
          const anchorId = `update-${date}-${catIdx}-${pointIdx}`;
          return `
          <li id="${anchorId}" class="text-gray-300 group relative">
            <button onclick="copyUpdateLink('${anchorId}')" class="absolute -left-6 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-sky-400" title="Copy link to this update">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
              </svg>
            </button>
            ${point.isBreaking ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-900 text-red-200 border border-red-700 mr-2" title="Breaking Change">⚠️</span>` : ''}${renderPointText(point.text)}
            ${point.commits.map(hash => `
              <a href="${GITHUB_COMMIT_URL}${hash}" target="_blank" rel="noopener noreferrer" class="text-sky-500 hover:text-sky-300 text-xs ml-2 font-mono">(${hash.substring(0, 7)})</a>
            `).join('')}
            ${point.components && point.components.length > 0 ? `<div class="flex flex-wrap items-center gap-1 mt-1">${renderComponentBadges(point.components)}</div>` : ''}
          </li>
        `;
        }).join('')}
      </ul>
    </div>
  `).join('');

  const filteredCommitHashes = new Set(filteredCommits.map(c => c.commit));
  const allCommitsHtml = allCommits.map(commit => {
    const isIncluded = filteredCommitHashes.has(commit.commit);
    const commitMessageFirstLine = commit.message.split('\n')[0].replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const includedClass = isIncluded ? '' : 'text-gray-500';
    const linkClass = isIncluded ? 'text-sky-500' : 'text-gray-600';
    const lineThroughClass = !isIncluded ? 'line-through' : '';

    return `
      <li class="flex items-baseline ${includedClass}">
        <a href="${GITHUB_COMMIT_URL}${commit.commit}" target="_blank" rel="noopener noreferrer" class="hover:underline ${linkClass}">
          ${commit.commit.substring(0, 7)}
        </a>
        <span class="ml-3 ${lineThroughClass}">${commitMessageFirstLine}</span>
      </li>
    `;
  }).join('');

  // Print overview before and after rendering for debugging
  console.log('Original Overview:', summary.overview);
  console.log('Rendered Overview:', renderOverview(summary.overview));

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="${assetsPath}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="summary-model" content="${escapedModelUsed}" />
    <title>Chromium Summary | ${date}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .prose code::before, .prose code::after { content: '' !important; }
    </style>
</head>
<body class="bg-gray-900 text-gray-200 font-sans">
    <header class="bg-gray-800 shadow-md">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center space-x-3">
          <img src="${assetsPath}" alt="Chromium Daily Digest Logo" class="h-8 w-8" />
          <div>
            <h1 class="text-2xl font-bold text-white tracking-tight">Chromium Changes Summarizer</h1>
            <p class="text-gray-400">Summary for ${date} on branch '${branch}'</p>
          </div>
        </div>
      </div>
    </header>
    <main class="container mx-auto px-4 py-8">
      <div class="bg-gray-800 p-6 rounded-lg shadow-lg">
        <div class="prose prose-invert max-w-none w-full">
          <h2 class="text-3xl font-bold text-white mb-6">${summary.title}</h2>
          <div class="bg-gray-800 p-4 rounded-lg mb-6 shadow-inner border border-gray-700">
            <h3 class="text-xl font-semibold text-white mb-2">Overview</h3>
            <div class="text-gray-300">${renderOverview(summary.overview)}</div>
          </div>
          ${categoriesHtml}
          <details class="mt-12 bg-gray-900/50 rounded-lg p-4 border border-gray-700">
            <summary class="cursor-pointer text-lg font-semibold text-white hover:text-sky-400">
              All Commits (${allCommits.length})
            </summary>
            <ul class="mt-4 space-y-2 text-sm font-mono">${allCommitsHtml}</ul>
          </details>
        </div>
      </div>
       <div class="mt-8 text-center">
        <a href="./index.html" class="text-sky-500 hover:text-sky-300">&larr; Back to all summaries</a>
      </div>
    </main>
    <script>
      // Remember the last read summary date (only ever moves forward to newer dates)
      try {
        const storedLastRead = localStorage.getItem('digest-last-read-date');
        if (!storedLastRead || storedLastRead < '${date}') {
          localStorage.setItem('digest-last-read-date', '${date}');
        }
      } catch (err) {}

      function copyUpdateLink(anchorId) {
        const url = window.location.origin + window.location.pathname + '#' + anchorId;
        navigator.clipboard.writeText(url).then(() => {
          // Show temporary feedback
          const element = document.getElementById(anchorId);
          if (element) {
            element.style.backgroundColor = 'rgba(14, 165, 233, 0.1)';
            setTimeout(() => {
              element.style.backgroundColor = '';
            }, 500);
          }
        });
      }
      
      // Scroll to anchor if present in URL
      if (window.location.hash) {
        setTimeout(() => {
          const element = document.getElementById(window.location.hash.substring(1));
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.style.backgroundColor = 'rgba(14, 165, 233, 0.1)';
          }
        }, 100);
      }
    </script>
</body>
</html>`;
};

export const updateIndexPage = async (outputDir: string, outputSubpath: string) => {
    // Calculate relative path to assets based on subdirectory depth
    const depth = outputSubpath ? outputSubpath.split('/').filter(p => p).length : 0;
    const prefix = depth > 0 ? '../'.repeat(depth) : '';
    const assetsPath = `${prefix}assets/daily-digest-logo.svg`;
    
    const files = await fs.readdir(outputDir);
    // Only include daily summaries matching YYYY-MM-DD.html pattern
    const dailyPattern = /^\d{4}-\d{2}-\d{2}\.html$/;
    const summaryPages = files
      .filter(file => dailyPattern.test(file))
      .sort()
      .reverse()
      .slice(0, 30); // Limit to last 30 days
    
    console.log(`  Found ${summaryPages.length} daily summary pages (limited to last 30 days)`);

    // Read all summary files and extract their content
    const summaries = await Promise.all(
      summaryPages.map(async (page) => {
        const date = page.replace('.html', '');
        const filePath = path.join(outputDir, page);
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Extract the entire summary content (title, overview, and all categories)
        const titleMatch = content.match(/<h2 class="text-3xl font-bold text-white mb-6">(.*?)<\/h2>/s);
        const modelMatch = content.match(/<meta name="summary-model" content="([^"]+)"/);
        const overviewSectionMatch = content.match(/<div class="bg-gray-800 p-4 rounded-lg mb-6 shadow-inner border border-gray-700">(.*?)<\/div>/s);
        // Capture all category sections between overview and the "All Commits" details section
        const categoriesSectionMatch = content.match(/<\/div>\s*<\/div>\s*((?:<div>[\s\S]*?<\/div>\s*)+)<details class="mt-12/s);
        
        const title = titleMatch ? titleMatch[1] : 'Summary';
        const overviewSection = overviewSectionMatch ? overviewSectionMatch[1] : '';
        const categoriesSection = categoriesSectionMatch ? categoriesSectionMatch[1] : '';
        
        return { date, page, title, overviewSection, categoriesSection, modelUsed: modelMatch?.[1] };
      })
    );
    
    console.log(`  Processed ${summaries.length} summaries`);

    const pageVersion = `${new Date().toISOString()}-${summaries[0]?.date ?? 'no-summaries'}-${summaries.length}`;
    console.log(`  Creating focused reader index with ${summaries.length} summaries`);

    const indexContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="${assetsPath}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="digest-version" content="${pageVersion}" />
    <title>Chromium Summaries</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .summary-item { display: none; scroll-margin-top: 96px; }
      .summary-item.active { display: block; }
    </style>
</head>
<body class="bg-gray-900 text-gray-200 font-sans">
    <header class="bg-gray-800 shadow-md">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center space-x-3">
          <img src="${assetsPath}" alt="Chromium Daily Digest Logo" class="h-10 w-10" />
          <div>
            <h1 class="text-3xl font-bold text-white tracking-tight">Chromium Daily Summaries</h1>
            <p class="text-gray-400 mt-1">Latest Chromium commits summarized daily</p>
          </div>
        </div>
      </div>
    </header>
    <div class="sticky top-0 z-30 bg-gray-900/95 backdrop-blur border-b border-gray-700 shadow-lg">
      <div class="container mx-auto px-4 py-2.5">
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div class="flex items-center gap-2">
            <button type="button" class="reader-older reader-nav px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium">
              ← Older
            </button>
            <button type="button" class="reader-newer reader-nav px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white">
              Newer →
            </button>
          </div>
          <div class="order-first w-full text-center sm:order-none sm:w-auto">
            <div id="reader-date" aria-live="polite" class="text-lg font-bold text-white leading-tight">Loading…</div>
            <div id="reader-position" class="text-[11px] text-gray-500"></div>
          </div>
          <div class="flex items-center gap-2">
            <select id="summary-jump" aria-label="Jump to a summary" class="bg-gray-800 border border-gray-700 rounded-lg text-sm px-2 py-1.5 text-gray-300 max-w-[11rem]">
            </select>
            <button type="button" class="reader-latest reader-nav px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium">
              Latest
            </button>
          </div>
        </div>
      </div>
    </div>
    <div aria-hidden="true" class="fixed right-3 top-1/2 -translate-y-1/2 z-20 hidden md:flex flex-col items-center gap-1 bg-gray-800/90 border border-gray-700 rounded-xl px-2 py-3 shadow-lg pointer-events-none select-none">
      <kbd class="w-7 h-7 flex items-center justify-center rounded-md bg-gray-700 border border-gray-600 text-xs font-bold text-white">K</kbd>
      <span class="text-sm leading-none text-sky-400">&uarr;</span>
      <span class="text-[10px] text-gray-400">older</span>
      <div class="w-6 h-px bg-gray-600"></div>
      <span class="text-[10px] text-gray-400">newer</span>
      <span class="text-sm leading-none text-sky-400">&darr;</span>
      <kbd class="w-7 h-7 flex items-center justify-center rounded-md bg-gray-700 border border-gray-600 text-xs font-bold text-white">J</kbd>
    </div>
    <main class="container mx-auto px-4 py-8">
      <div class="mb-6 text-center">
        <a href="./weeklies.html" class="text-green-500 hover:text-green-300 text-lg font-semibold">📅 View Weekly Summaries →</a>
      </div>
      <div id="summaries-container" class="space-y-8">
        ${summaries.length === 0 ? '<p class="text-gray-400">No summaries generated yet.</p>' : summaries.map(summary => `
        <article id="summary-${summary.date}" data-date="${summary.date}" class="summary-item bg-gray-800 rounded-lg shadow-lg border border-gray-700">
          <div class="bg-gray-900/50 p-4 rounded-t-lg border-b border-gray-700 flex justify-between items-center">
            <h2 class="text-2xl font-bold text-white">${summary.date}</h2>
             ${summary.modelUsed ? `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-sky-900/70 border border-sky-700 text-sky-200 text-xs font-medium">Summarized by ${summary.modelUsed}</span>` : ''}
             <a href="./${summary.page}" class="text-sky-400 hover:text-sky-300 text-sm flex items-center gap-1">
              <span>Open Standalone Page</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
              </svg>
            </a>
          </div>
          <div class="p-6">
            <div class="prose prose-invert max-w-none w-full">
              <h3 class="text-3xl font-bold text-white mb-6">${summary.title}</h3>
              ${summary.overviewSection}
              ${summary.categoriesSection}
            </div>
          </div>
        </article>
        `).join('')}
      </div>

      <div class="mt-8 flex flex-wrap justify-center items-center gap-3">
        <button type="button" class="reader-older reader-nav px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium">
          ← Older
        </button>
        <button type="button" class="reader-latest reader-nav px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium">
          Latest
        </button>
        <button type="button" class="reader-newer reader-nav px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white">
          Newer →
        </button>
      </div>
      <p class="mt-3 text-center text-xs text-gray-500">Use J / K to move between newer and older summaries.</p>
    </main>
    
    <script>
      const currentDigestVersion = document.querySelector('meta[name="digest-version"]')?.getAttribute('content') || '';
      let updateBannerVisible = false;

      function showUpdateBanner() {
        if (updateBannerVisible) return;

        updateBannerVisible = true;

        const banner = document.createElement('div');
        banner.id = 'digest-update-banner';
        banner.className = 'fixed bottom-4 right-4 max-w-sm bg-sky-900/95 border border-sky-600 text-white rounded-lg shadow-2xl px-4 py-3 z-50';
        banner.innerHTML = '<div class="flex items-center justify-between gap-4"><p class="text-sm">A newer version of this page is available.</p><button id="digest-refresh-btn" class="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-sm font-semibold rounded whitespace-nowrap">Refresh</button></div>';

        document.body.appendChild(banner);
        document.getElementById('digest-refresh-btn')?.addEventListener('click', () => {
          window.location.reload();
        });

        const faviconLink = document.querySelector('link[rel="icon"]');
        if (faviconLink) {
          const updatedHref = faviconLink.getAttribute('href')?.replace(/daily-digest-logo\.svg$/, 'daily-digest-logo-new.svg');
          if (updatedHref) {
            faviconLink.setAttribute('href', updatedHref);
          }
        }

        const logoImage = document.querySelector('img[alt="Chromium Daily Digest Logo"]');
        if (logoImage) {
          const updatedSrc = logoImage.getAttribute('src')?.replace(/daily-digest-logo\.svg$/, 'daily-digest-logo-new.svg');
          if (updatedSrc) {
            logoImage.setAttribute('src', updatedSrc);
          }
        }
      }

      async function checkForNewerIndexVersion() {
        if (!currentDigestVersion) return;

        try {
          const url = new URL(window.location.href);
          url.searchParams.set('_digestVersionCheck', Date.now().toString());

          const response = await fetch(url.toString(), {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache'
            }
          });

          if (!response.ok) return;

          const html = await response.text();
          const versionMatch = html.match(/<meta\\s+name=["']digest-version["']\\s+content=["']([^"']+)["']/i);
          const fetchedVersion = versionMatch?.[1];

          if (fetchedVersion && fetchedVersion !== currentDigestVersion) {
            showUpdateBanner();
          }
        } catch {
          // Ignore update check failures in the background.
        }
      }

      // ----- Focused summary reader -----
      const summaryArticles = Array.from(document.querySelectorAll('.summary-item'));
      const summaryDates = summaryArticles
        .map(el => el.id.replace('summary-', ''))
        .sort();
      const summaryByDate = {};
      summaryArticles.forEach(el => {
        summaryByDate[el.id.replace('summary-', '')] = el;
      });

      const readerDate = document.getElementById('reader-date');
      const readerPosition = document.getElementById('reader-position');
      const jumpSelect = document.getElementById('summary-jump');

      let currentSummaryIdx = -1;
      let readMarkTimer = null;
      let fallbackSummaryDate = null;

      const LAST_READ_KEY = 'digest-last-read-date';
      let lastReadDate = null;
      try {
        lastReadDate = localStorage.getItem(LAST_READ_KEY);
      } catch (err) {
        lastReadDate = null;
      }

      if (jumpSelect) {
        jumpSelect.innerHTML = summaryDates.map(date => {
          const latest = date === summaryDates[summaryDates.length - 1] ? ' (latest)' : '';
          return '<option value="' + date + '">' + date + latest + '</option>';
        }).join('');
      }

      function markSummaryRead(date) {
        if (!date) return;
        if (lastReadDate && date <= lastReadDate) return;
        lastReadDate = date;
        try {
          localStorage.setItem(LAST_READ_KEY, date);
        } catch (err) {}
      }

      function scheduleReadMark(date) {
        if (readMarkTimer) clearTimeout(readMarkTimer);
        readMarkTimer = setTimeout(() => markSummaryRead(date), 2000);
      }

      function updateReaderControls() {
        const noSummaries = summaryDates.length === 0;
        document.querySelectorAll('.reader-older').forEach(button => {
          button.disabled = noSummaries || currentSummaryIdx <= 0;
        });
        document.querySelectorAll('.reader-newer').forEach(button => {
          button.disabled = noSummaries || currentSummaryIdx >= summaryDates.length - 1;
        });
        document.querySelectorAll('.reader-latest').forEach(button => {
          button.disabled = noSummaries || currentSummaryIdx >= summaryDates.length - 1;
        });
      }

      function updateHash(date, mode) {
        if (!mode || mode === false) return;
        const url = window.location.pathname + window.location.search + '#summary-' + date;
        if (mode === 'replace') {
          window.history.replaceState({ summary: date }, '', url);
        } else {
          window.history.pushState({ summary: date }, '', url);
        }
      }

      function showSummaryByDate(date, options) {
        options = options || {};
        const idx = summaryDates.indexOf(date);
        if (idx === -1) return false;
        const article = summaryByDate[date];
        if (!article) return false;

        currentSummaryIdx = idx;
        summaryArticles.forEach(item => item.classList.remove('active'));
        article.classList.add('active');

        if (readerDate) readerDate.textContent = date;
        if (readerPosition) {
          readerPosition.textContent = (idx + 1) + ' of ' + summaryDates.length + (idx === summaryDates.length - 1 ? ' · latest' : '');
        }
        if (jumpSelect) jumpSelect.value = date;
        updateReaderControls();

        const historyMode = options.history === undefined ? 'push' : options.history;
        updateHash(date, historyMode);

        if (idx === summaryDates.length - 1) {
          dismissUnreadToast();
        }

        if (options.scroll !== false) {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }

        scheduleReadMark(date);
        return true;
      }

      function showSummaryByIndex(idx, options) {
        if (summaryDates.length === 0) return;
        idx = Math.max(0, Math.min(summaryDates.length - 1, idx));
        showSummaryByDate(summaryDates[idx], options);
      }

      function goOlder() {
        showSummaryByIndex(currentSummaryIdx - 1);
      }

      function goNewer() {
        showSummaryByIndex(currentSummaryIdx + 1);
      }

      function goLatest() {
        showSummaryByIndex(summaryDates.length - 1);
      }

      document.querySelectorAll('.reader-older').forEach(button => {
        button.addEventListener('click', goOlder);
      });
      document.querySelectorAll('.reader-newer').forEach(button => {
        button.addEventListener('click', goNewer);
      });
      document.querySelectorAll('.reader-latest').forEach(button => {
        button.addEventListener('click', goLatest);
      });

      if (jumpSelect) {
        jumpSelect.addEventListener('change', () => {
          showSummaryByDate(jumpSelect.value);
        });
      }

      // ----- Unread notification -----
      let unreadToast = null;

      function dismissUnreadToast() {
        if (unreadToast) {
          unreadToast.remove();
          unreadToast = null;
        }
      }

      function showUnreadToast(count) {
        dismissUnreadToast();
        unreadToast = document.createElement('div');
        unreadToast.id = 'unread-toast';
        unreadToast.setAttribute('role', 'status');
        unreadToast.className = 'fixed top-24 left-1/2 -translate-x-1/2 z-40 max-w-[94vw] bg-sky-900/95 border border-sky-600 text-white rounded-lg shadow-2xl px-4 py-3 flex flex-wrap items-center gap-3';
        const label = count === 1 ? 'new summary' : 'new summaries';
        unreadToast.innerHTML =
          '<span class="text-sm">' + count + ' ' + label + ' since your last visit</span>' +
          '<button id="goto-latest-btn" class="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-sm font-semibold rounded whitespace-nowrap">Go to latest</button>' +
          '<button id="dismiss-unread-btn" class="text-gray-400 hover:text-white text-xl leading-none px-1" aria-label="Dismiss">&times;</button>';
        document.body.appendChild(unreadToast);
        document.getElementById('goto-latest-btn').addEventListener('click', () => {
          dismissUnreadToast();
          goLatest();
        });
        document.getElementById('dismiss-unread-btn').addEventListener('click', dismissUnreadToast);
      }

      // ----- Deep links and browser history -----
      function hashValue() {
        return window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : '';
      }

      function dateFromHash() {
        const value = hashValue();
        if (!value) return null;
        if (value.indexOf('summary-') === 0) return value.slice('summary-'.length);
        const element = document.getElementById(value);
        const article = element ? element.closest('.summary-item') : null;
        return article ? article.id.replace('summary-', '') : null;
      }

      function anchorFromHash() {
        const value = hashValue();
        if (!value || value.indexOf('summary-') === 0) return null;
        return document.getElementById(value);
      }

      function highlightAnchor(element) {
        if (!element) return;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.style.backgroundColor = 'rgba(14, 165, 233, 0.1)';
        setTimeout(() => {
          element.style.backgroundColor = '';
        }, 1000);
      }

      function copyUpdateLink(anchorId) {
        const url = window.location.origin + window.location.pathname + '#' + anchorId;
        navigator.clipboard.writeText(url).then(() => {
          // Show temporary feedback
          const element = document.getElementById(anchorId);
          if (element) {
            element.style.backgroundColor = 'rgba(14, 165, 233, 0.1)';
            setTimeout(() => {
              element.style.backgroundColor = '';
            }, 500);
          }
        });
      }

      // ----- Keyboard navigation -----
      document.addEventListener('keydown', (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target;
        const tag = target ? target.tagName : null;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
        const key = event.key ? event.key.toLowerCase() : '';
        if (key === 'j') {
          event.preventDefault();
          goNewer();
        } else if (key === 'k') {
          event.preventDefault();
          goOlder();
        }
      });

      // ----- Init -----
      if (summaryDates.length === 0) {
        if (readerDate) readerDate.textContent = 'No summaries';
        if (readerPosition) readerPosition.textContent = '';
        updateReaderControls();
      } else {
        const hashDate = dateFromHash();
        const hashAnchor = anchorFromHash();

        if (hashDate) {
          // Keep update anchors intact, but normalize summary links.
          showSummaryByDate(hashDate, { history: hashAnchor ? false : 'replace' });
          if (hashAnchor) {
            setTimeout(() => highlightAnchor(hashAnchor), 150);
          }
        } else {
          const unreadDates = lastReadDate ? summaryDates.filter(date => date > lastReadDate) : [];
          if (unreadDates.length > 0) {
            // Resume at the first unread summary so the reader can continue
            // forward in time from where they left off.
            showSummaryByDate(unreadDates[0], { history: false });
            fallbackSummaryDate = unreadDates[0];
            if (unreadDates[0] !== summaryDates[summaryDates.length - 1]) {
              showUnreadToast(unreadDates.length);
            }
          } else {
            showSummaryByIndex(summaryDates.length - 1, { history: false });
            fallbackSummaryDate = summaryDates[summaryDates.length - 1];
          }
        }
      }

      window.addEventListener('popstate', () => {
        const hashDate = dateFromHash();
        if (hashDate) {
          showSummaryByDate(hashDate, { history: false });
        } else if (fallbackSummaryDate) {
          showSummaryByDate(fallbackSummaryDate, { history: false });
        } else if (summaryDates.length > 0) {
          showSummaryByIndex(summaryDates.length - 1, { history: false });
        }
        const hashAnchor = anchorFromHash();
        if (hashAnchor) {
          setTimeout(() => highlightAnchor(hashAnchor), 100);
        }
      });

      setTimeout(() => {
        checkForNewerIndexVersion();
        setInterval(checkForNewerIndexVersion, 5 * 60 * 1000);
      }, 30 * 1000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForNewerIndexVersion();
        }
      });
    </script>
</body>
</html>`;

    await fs.writeFile(path.join(outputDir, 'index.html'), indexContent);
    console.log('✓ Index page updated with focused reader');
};


const run = async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: tsx scripts/generate-page.ts <date> <branch> [config-file]');
    console.error('');
    console.error('Arguments:');
    console.error('  <date>        Date in YYYY-MM-DD format');
    console.error('  <branch>      Branch name (e.g., main)');
    console.error('  [config-file] Optional path to JSON config file');
    console.error('');
    console.error('Examples:');
    console.error('  tsx scripts/generate-page.ts 2025-11-09 main');
    console.error('  tsx scripts/generate-page.ts 2025-11-09 main config.json');
    console.error('  tsx scripts/generate-page.ts 2025-11-09 main custom-config.json');
    console.error('');
    console.error('Config file format (all fields optional):');
    console.error('  {');
    console.error('    "customInstructions": "Focus on V8 and Blink changes",');
    console.error('    "interestingKeywords": "performance,security,v8",');
    console.error('    "outputPath": "public/summaries",');
    console.error('    "ignoredBotEmails": ["bot@example.com"],');
    console.error('    "focusAreas": ["V8", "Blink", "DevTools"]');
    console.error('  }');
    process.exit(1);
  }

  const [date, branch, configFile] = args;
  
  // Load configuration
  let config: SummaryConfig;
  try {
    config = await loadConfig(configFile);
  } catch (error) {
    console.error('Failed to load configuration. Using defaults.');
    process.exit(1);
  }
  
  // Get bot emails to ignore
  const IGNORED_BOT_EMAILS = getIgnoredBotEmails(config);
  
  const githubToken = process.env.SECRET_GITHUB_TOKEN;
  if (githubToken) {
    console.log('Using GitHub token for authentication to avoid rate limits.');
  } else {
    console.warn('No SECRET_GITHUB_TOKEN found in environment. API calls may be rate-limited.');
  }
  
  console.log(`Generating summary for ${date} on branch '${branch}'...`);
  console.log('Step 1/5: Fetching commits from GitHub...');

  try {
    const allCommits = await fetchCommitsForDate(date, branch, githubToken);
    console.log(`✓ Fetched ${allCommits.length} commits successfully`);
    
    if (!allCommits || allCommits.length === 0) {
      console.error(`No commits found for ${date} on branch '${branch}'.`);
      return;
    }

    console.log('Step 2/5: Filtering commits...');
    const totalCommitsCount = allCommits.length;
    
    const filteredCommits = allCommits.filter(commit => {
      const message = commit.message;
      const firstLine = message.split('\n')[0];
      const authorEmail = commit.author.email.toLowerCase();
      
      // Check if commit is from an ignored bot
      if (IGNORED_BOT_EMAILS.includes(authorEmail)) {
        return false;
      }
      
      // Check if message indicates a version update
      if (/updating\s+(trunk\s+)?version\s+from/i.test(firstLine)) {
        return false;
      }
      
      return true;
    });

    if (filteredCommits.length === 0) {
      console.error(`All commits for ${date} were filtered out by the ignored keywords.`);
      return;
    }

    const relevantCommitsCount = filteredCommits.length;
    const firstCommit = filteredCommits[filteredCommits.length - 1];
    const lastCommit = filteredCommits[0];
    
    console.log(`✓ Filtered to ${relevantCommitsCount} relevant commits out of ${totalCommitsCount} total`);
    console.log(`  Filtered out: ${totalCommitsCount - relevantCommitsCount} commits`);
    console.log('Step 3/5: Generating summary with AI...');

    // Create LLM service with configured provider (defaults to Gemini)
    const llmService = createLLMService(config.llmProvider || 'gemini');
    const summaryContent = await llmService.generateSummary(
      filteredCommits, 
      config,
      date, 
      branch,
      totalCommitsCount,
      relevantCommitsCount,
      firstCommit,
      lastCommit
    );
    
    console.log('✓ Summary generated successfully');
    console.log(`  Title: ${summaryContent.title}`);
    console.log(`  Categories: ${summaryContent.categories.length}`);
    console.log('Step 4/5: Creating HTML page...');

    // Build output directory: public/summaries/{subpath}
    const baseDir = path.join(process.cwd(), 'public', 'summaries');
    const outputDir = config.outputPath 
      ? path.join(baseDir, config.outputPath) 
      : baseDir;
    await fs.mkdir(outputDir, { recursive: true });
    
    const fullHtml = createHtmlPage(summaryContent, allCommits, filteredCommits, date, branch, config.outputPath || '');
    
    const outputPath = path.join(outputDir, `${date}.html`);
    await fs.writeFile(outputPath, fullHtml);
    console.log(`✓ Summary page saved to: ${outputPath}`);
    
    console.log('Step 5/5: Updating index page...');
    await updateIndexPage(outputDir, config.outputPath || '');
    console.log('\n✅ All done! Summary generation completed successfully.');

  } catch (err) {
    if (err instanceof Error) {
      console.error(`An error occurred: ${err.message}`);
    } else {
      console.error('An unknown error occurred.');
    }
    process.exit(1);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  run();
}
