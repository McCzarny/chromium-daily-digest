import { SummaryConfig, StructuredSummary } from '../types';
import { loadConfig } from '../config';
import { createLLMService, DailySummaryData } from '../services/llmService';
import { renderOverview, renderPointText, renderComponentBadges, getAssetsPath, GITHUB_COMMIT_URL } from '../utils/htmlUtils';
import { getWeekNumber, parseDate, formatDate } from '../utils/dateUtils';
import fs from 'fs/promises';
import path from 'path';
import { parse as parseHTML } from 'node-html-parser';

interface WeeklyData {
  year: number;
  week: number;
  startDate: string;
  endDate: string;
  dailySummaries: DailySummaryData[];
}

const parseDailySummary = async (htmlPath: string, date: string): Promise<DailySummaryData | null> => {
  try {
    const content = await fs.readFile(htmlPath, 'utf-8');
    const root = parseHTML(content);
    
    // Extract title
    const titleElement = root.querySelector('h2.text-3xl');
    const title = titleElement?.text || `Summary for ${date}`;
    
    // Extract overview
    const overviewElement = root.querySelector('.bg-gray-800.p-4.rounded-lg.mb-6 .text-gray-300');
    let overview = overviewElement?.text || '';
    
    // Extract commit counts from overview
    let totalCommits = 0;
    let relevantCommits = 0;
    const commitMatch = overview.match(/(\d+)\s+relevant\s+commits\s+out\s+of\s+(\d+)\s+total/);
    if (commitMatch) {
      relevantCommits = parseInt(commitMatch[1]);
      totalCommits = parseInt(commitMatch[2]);
    }
    
    // Extract categories
    const categories: DailySummaryData['categories'] = [];
    const categoryDivs = root.querySelectorAll('h3.text-2xl.font-semibold.text-sky-400');
    
    for (const categoryHeader of categoryDivs) {
      const categoryTitle = categoryHeader.text;
      const categoryDiv = categoryHeader.parentNode;
      
      if (!categoryDiv) continue;
      
      const points: DailySummaryData['categories'][0]['points'] = [];
      const listItems = categoryDiv.querySelectorAll('li.text-gray-300');
      
      for (const li of listItems) {
        const isBreaking = li.querySelector('.bg-red-900') !== null;
        
        // Extract text (remove the breaking badge and commit links)
        let text = li.text;
        if (isBreaking) {
          text = text.replace(/⚠️\s*/g, '').trim();
        }
        
        // Extract commit hashes
        const commitLinks = li.querySelectorAll('a[href*="/commit/"]');
        const commits = commitLinks.map(link => {
          const href = link.getAttribute('href') || '';
          const match = href.match(/commit\/([a-f0-9]+)/);
          return match ? match[1] : '';
        }).filter(hash => hash.length > 0);
        
        // Remove commit references from text
        text = text.replace(/\([a-f0-9]{7}\)/g, '').trim();
        
        // Extract component tags from badge spans
        const componentSpans = li.querySelectorAll('span[class*="border"]');
        const components = componentSpans
          .map(span => span.text.trim())
          .filter(text => text && text !== '⚠️');

        points.push({ text, isBreaking, commits, components });
      }
      
      if (points.length > 0) {
        categories.push({ title: categoryTitle, points });
      }
    }
    
    return {
      date,
      title,
      overview,
      categories,
      totalCommits,
      relevantCommits
    };
  } catch (error) {
    console.error(`Failed to parse ${htmlPath}:`, error);
    return null;
  }
};

const aggregateWeeklyData = (dailySummaries: DailySummaryData[]): WeeklyData[] => {
  const weekMap = new Map<string, WeeklyData>();
  
  for (const daily of dailySummaries) {
    const date = parseDate(daily.date);
    const year = date.getFullYear();
    const week = getWeekNumber(date);
    const weekKey = `${year}-W${week}`;
    
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, {
        year,
        week,
        startDate: daily.date,
        endDate: daily.date,
        dailySummaries: []
      });
    }
    
    const weekData = weekMap.get(weekKey)!;
    weekData.dailySummaries.push(daily);
    
    // Update date range
    if (daily.date < weekData.startDate) {
      weekData.startDate = daily.date;
    }
    if (daily.date > weekData.endDate) {
      weekData.endDate = daily.date;
    }
  }
  
  // Sort daily summaries within each week
  for (const weekData of weekMap.values()) {
    weekData.dailySummaries.sort((a, b) => a.date.localeCompare(b.date));
  }
  
  return Array.from(weekMap.values()).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.week - b.week;
  });
};

const generateWeeklySummaryWithAI = async (weekData: WeeklyData, config: SummaryConfig): Promise<StructuredSummary> => {
  const llmService = createLLMService(config.llmProvider || 'gemini');
  return llmService.generateWeeklySummary(
    weekData.dailySummaries,
    config,
    weekData.startDate,
    weekData.endDate,
    weekData.year,
    weekData.week
  );
};

const createWeeklyHtml = (summary: StructuredSummary, weekData: WeeklyData, allWeeklyData: WeeklyData[], outputSubpath: string): string => {
  const totalDays = weekData.dailySummaries.length;
  const totalCommits = weekData.dailySummaries.reduce((sum, d) => sum + d.totalCommits, 0);
  const totalRelevantCommits = weekData.dailySummaries.reduce((sum, d) => sum + d.relevantCommits, 0);
  const assetsPath = getAssetsPath(outputSubpath, 'weekly-digest-logo.svg');
  
  const categoriesHtml = summary.categories.map((category, catIdx) => `
    <div>
      <h3 class="text-2xl font-semibold text-sky-400 mt-6 mb-4">${category.title}</h3>
      <ul class="list-disc list-inside space-y-3">
        ${category.points.map((point, pointIdx) => {
          const anchorId = `update-${weekData.year}-W${weekData.week}-${catIdx}-${pointIdx}`;
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
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="assets/weekly-digest-logo.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chromium Weekly Summary | ${weekData.year} Week ${weekData.week}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .prose code::before, .prose code::after { content: '' !important; }
    </style>
</head>
<body class="bg-gray-900 text-gray-200 font-sans">
    <header class="bg-gray-800 shadow-md border-b-2 border-green-600">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center space-x-3">
          <img src="${assetsPath}" alt="Chromium Weekly Digest Logo" class="h-8 w-8" />
          <div>
            <h1 class="text-2xl font-bold text-white tracking-tight">Chromium Weekly Digest</h1>
            <p class="text-gray-400">Week ${weekData.week} of ${weekData.year} (${weekData.startDate} to ${weekData.endDate})</p>
          </div>
        </div>
      </div>
    </header>
    <main class="container mx-auto px-4 py-8">
      <div class="bg-gray-800 p-6 rounded-lg shadow-lg border border-green-800">
        <div class="prose prose-invert max-w-none w-full">
          <h2 class="text-3xl font-bold text-white mb-6">Chromium Weekly: ${weekData.year} Week ${weekData.week}</h2>
          <div class="bg-gray-800 p-4 rounded-lg mb-6 shadow-inner border border-gray-700">
            <h3 class="text-xl font-semibold text-white mb-2">Overview</h3>
            <div class="text-gray-300">${renderOverview(summary.overview)}</div>
          </div>
          ${categoriesHtml}
          <details class="mt-12 bg-gray-900/50 rounded-lg p-4 border border-gray-700">
            <summary class="cursor-pointer text-lg font-semibold text-white hover:text-sky-400">
              Daily Summaries (${totalDays})
            </summary>
            <ul class="mt-4 space-y-2">
              ${weekData.dailySummaries.map(daily => `
                <li>
                  <a href="./${daily.date}.html" class="text-sky-500 hover:text-sky-300">
                    ${daily.date}: ${daily.title}
                  </a>
                  <span class="text-gray-500 text-sm ml-2">(${daily.relevantCommits} commits)</span>
                </li>
              `).join('')}
            </ul>
          </details>
        </div>
      </div>
      <div class="mt-8 text-center">
        <a href="./index.html" class="text-sky-500 hover:text-sky-300">&larr; Back to all summaries</a>
      </div>
    </main>
    <script>
      function copyUpdateLink(anchorId) {
        const url = window.location.origin + window.location.pathname + '#' + anchorId;
        navigator.clipboard.writeText(url).then(() => {
          const element = document.getElementById(anchorId);
          if (element) {
            element.style.backgroundColor = 'rgba(14, 165, 233, 0.1)';
            setTimeout(() => {
              element.style.backgroundColor = '';
            }, 500);
          }
        });
      }
      
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

export const updateWeekliesIndex = async (outputDir: string, outputSubpath: string) => {
  const assetsPath = getAssetsPath(outputSubpath, 'weekly-digest-logo.svg');
  
  const files = await fs.readdir(outputDir);
  // Only include weekly summaries matching YYYY-WNN.html pattern
  const weeklyPattern = /^\d{4}-W\d{1,2}\.html$/;
  const weeklyPages = files
    .filter(file => weeklyPattern.test(file))
    .sort((a, b) => {
      const parseWeek = (file: string) => {
        const [year, week] = file.replace('.html', '').split('-W').map(Number);
        return { year, week };
      };
      const aWeek = parseWeek(a);
      const bWeek = parseWeek(b);
      return aWeek.year - bWeek.year || aWeek.week - bWeek.week;
    })
    .reverse();
  
  console.log(`  Found ${weeklyPages.length} weekly summary pages`);

  // Read all weekly files and extract their content
  const weeklies = await Promise.all(
    weeklyPages.map(async (page) => {
      const filePath = path.join(outputDir, page);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Extract week identifier from filename (e.g., "2025-W46")
      const weekId = page.replace('.html', '');
      const [yearStr, weekStr] = weekId.split('-W');
      const year = parseInt(yearStr);
      const week = parseInt(weekStr);
      
      // Extract title and overview
      const titleMatch = content.match(/<h2 class="text-3xl font-bold text-white mb-6">(.*?)<\/h2>/s);
      const overviewSectionMatch = content.match(/<div class="bg-gray-800 p-4 rounded-lg mb-6 shadow-inner border border-gray-700">(.*?)<\/div>/s);
      const categoriesSectionMatch = content.match(/<\/div>\s*<\/div>\s*((?:<div>[\s\S]*?<\/div>\s*)+)<details class="mt-12/s);
      
      const title = titleMatch ? titleMatch[1] : `Week ${week} of ${year}`;
      const overviewSection = overviewSectionMatch ? overviewSectionMatch[1] : '';
      const categoriesSection = categoriesSectionMatch ? categoriesSectionMatch[1] : '';
      
      // Extract date range from overview or filename
      const dateRangeMatch = content.match(/Week \d+ of \d+ \((\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\)/);
      const startDate = dateRangeMatch ? dateRangeMatch[1] : '';
      const endDate = dateRangeMatch ? dateRangeMatch[2] : '';
      
      // Count daily summaries linked
      const dailyLinksMatch = content.match(/Daily Summaries \((\d+)\)/);
      const daysCount = dailyLinksMatch ? parseInt(dailyLinksMatch[1]) : 0;
      
      return { 
        page, 
        weekId, 
        year, 
        week, 
        title, 
        overviewSection, 
        categoriesSection,
        startDate,
        endDate,
        daysCount
      };
    })
  );
  
  console.log(`  Processed ${weeklies.length} weekly summaries`);
  console.log(`  Creating weekly focused reader index with ${weeklies.length} summaries`);

  const indexContent = createWeekliesIndexHtml(weeklies, assetsPath, !outputSubpath);
  
  await fs.writeFile(path.join(outputDir, 'weeklies.html'), indexContent);
};

interface WeeklySummaryInfo {
  page: string;
  weekId: string;
  year: number;
  week: number;
  title: string;
  overviewSection: string;
  categoriesSection: string;
  startDate: string;
  endDate: string;
  daysCount: number;
}

const createWeekliesIndexHtml = (
  weeklies: WeeklySummaryInfo[], 
  assetsPath: string,
  showDisabledBanner: boolean = false
): string => {
  // Base summaries are paused, but the on-top-of-chromium variant keeps running.
  const disabledBanner = showDisabledBanner ? `    <div class="bg-amber-900/40 border-b border-amber-600/60">
      <div class="container mx-auto px-4 py-3">
        <p class="text-sm text-amber-100">
          <span aria-hidden="true" class="mr-2">⚠️</span>Summarisation has been disabled to avoid unnecessary token burning. Please let me know if you need this page to be updated here: <a href="https://github.com/McCzarny/chromium-daily-digest/issues" target="_blank" rel="noopener noreferrer" class="font-semibold text-amber-200 underline hover:text-white">https://github.com/McCzarny/chromium-daily-digest/issues</a>
        </p>
      </div>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="${assetsPath}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chromium Weekly Summaries</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .summary-item { display: none; scroll-margin-top: 96px; }
      .summary-item.active { display: block; }
    </style>
</head>
<body class="bg-gray-900 text-gray-200 font-sans">
    <header class="bg-gray-800 shadow-md border-b-2 border-green-600">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center space-x-3">
          <img src="${assetsPath}" alt="Chromium Weekly Digest Logo" class="h-10 w-10" />
          <div>
            <h1 class="text-3xl font-bold text-white tracking-tight">Chromium Weekly Summaries</h1>
            <p class="text-gray-400 mt-1">Weekly aggregated summaries of Chromium development</p>
          </div>
        </div>
      </div>
    </header>
${disabledBanner}
    <div class="sticky top-0 z-30 bg-gray-900/95 backdrop-blur border-b border-gray-700 shadow-lg">
      <div class="container mx-auto px-4 py-2.5">
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div class="flex items-center gap-2">
            <button type="button" class="reader-older reader-nav px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium">
              ← Older
            </button>
            <button type="button" class="reader-newer reader-nav px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white">
              Newer →
            </button>
          </div>
          <div class="order-first w-full text-center sm:order-none sm:w-auto">
            <div id="reader-date" aria-live="polite" class="text-lg font-bold text-white leading-tight">Loading…</div>
            <div id="reader-position" class="text-[11px] text-gray-500"></div>
          </div>
          <div class="flex items-center gap-2">
            <select id="summary-jump" aria-label="Jump to a weekly summary" class="bg-gray-800 border border-gray-700 rounded-lg text-sm px-2 py-1.5 text-gray-300 max-w-[11rem]">
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
      <span class="text-sm leading-none text-green-400">&uarr;</span>
      <span class="text-[10px] text-gray-400">older</span>
      <div class="w-6 h-px bg-gray-600"></div>
      <span class="text-[10px] text-gray-400">newer</span>
      <span class="text-sm leading-none text-green-400">&darr;</span>
      <kbd class="w-7 h-7 flex items-center justify-center rounded-md bg-gray-700 border border-gray-600 text-xs font-bold text-white">J</kbd>
    </div>
    <main class="container mx-auto px-4 py-8">
      <div class="mb-6 text-center">
        <a href="./index.html" class="text-green-500 hover:text-green-300 text-lg font-semibold">📄 View Daily Summaries →</a>
      </div>
      <div id="summaries-container" class="space-y-8">
        ${weeklies.length === 0 ? '<p class="text-gray-400">No weekly summaries generated yet.</p>' : 
          weeklies.map(weekly => `
        <article id="week-${weekly.year}-${weekly.week}" data-sort="${weekly.year}-${String(weekly.week).padStart(2, '0')}" data-label="${weekly.year} Week ${weekly.week}" class="summary-item bg-gray-800 rounded-lg shadow-lg border border-green-800">
          <div class="bg-gray-900/50 p-4 rounded-t-lg border-b border-gray-700 flex justify-between items-center">
            <h2 class="text-2xl font-bold text-white">${weekly.year} Week ${weekly.week}</h2>
            <a href="./${weekly.page}" class="text-green-400 hover:text-green-300 text-sm flex items-center gap-1">
              <span>Open Standalone Page</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
              </svg>
            </a>
          </div>
          <div class="p-6">
            <div class="prose prose-invert max-w-none w-full">
              <h3 class="text-3xl font-bold text-white mb-6">${weekly.title}</h3>
              ${weekly.overviewSection}
              ${weekly.categoriesSection}
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
        <button type="button" class="reader-newer reader-nav px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white">
          Newer →
        </button>
      </div>
      <p class="mt-3 text-center text-xs text-gray-500">Use J / K to move between newer and older weekly summaries.</p>
    </main>
    
    <script>
      // ----- Focused weekly summary reader -----
      const summaryArticles = Array.from(document.querySelectorAll('.summary-item')).sort((a, b) => {
        const aKey = a.dataset.sort || a.id;
        const bKey = b.dataset.sort || b.id;
        return aKey.localeCompare(bKey);
      });
      const summaryIndexById = {};
      summaryArticles.forEach((article, idx) => {
        summaryIndexById[article.id] = idx;
      });

      const readerDate = document.getElementById('reader-date');
      const readerPosition = document.getElementById('reader-position');
      const jumpSelect = document.getElementById('summary-jump');

      let currentSummaryIdx = -1;

      function summaryLabel(article) {
        return article.dataset.label || article.id;
      }

      if (jumpSelect) {
        jumpSelect.innerHTML = summaryArticles.map((article, idx) => {
          const latest = idx === summaryArticles.length - 1 ? ' (latest)' : '';
          return '<option value="' + article.id + '">' + summaryLabel(article) + latest + '</option>';
        }).join('');
      }

      function updateReaderControls() {
        const noSummaries = summaryArticles.length === 0;
        document.querySelectorAll('.reader-older').forEach(button => {
          button.disabled = noSummaries || currentSummaryIdx <= 0;
        });
        document.querySelectorAll('.reader-newer').forEach(button => {
          button.disabled = noSummaries || currentSummaryIdx >= summaryArticles.length - 1;
        });
        document.querySelectorAll('.reader-latest').forEach(button => {
          button.disabled = noSummaries || currentSummaryIdx >= summaryArticles.length - 1;
        });
      }

      function updateHash(id, mode) {
        if (!mode || mode === false) return;
        const url = window.location.pathname + window.location.search + '#' + id;
        if (mode === 'replace') {
          window.history.replaceState({ weekly: id }, '', url);
        } else {
          window.history.pushState({ weekly: id }, '', url);
        }
      }

      function showWeeklyById(id, options) {
        options = options || {};
        const idx = summaryIndexById[id];
        if (idx === undefined) return false;
        const article = summaryArticles[idx];

        currentSummaryIdx = idx;
        summaryArticles.forEach(item => item.classList.remove('active'));
        article.classList.add('active');

        if (readerDate) readerDate.textContent = summaryLabel(article);
        if (readerPosition) {
          readerPosition.textContent = (idx + 1) + ' of ' + summaryArticles.length + (idx === summaryArticles.length - 1 ? ' · latest' : '');
        }
        if (jumpSelect) jumpSelect.value = id;
        updateReaderControls();

        const historyMode = options.history === undefined ? 'push' : options.history;
        updateHash(id, historyMode);

        if (options.scroll !== false) {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
        return true;
      }

      function showWeeklyByIndex(idx, options) {
        if (summaryArticles.length === 0) return;
        idx = Math.max(0, Math.min(summaryArticles.length - 1, idx));
        showWeeklyById(summaryArticles[idx].id, options);
      }

      function goOlder() {
        showWeeklyByIndex(currentSummaryIdx - 1);
      }

      function goNewer() {
        showWeeklyByIndex(currentSummaryIdx + 1);
      }

      function goLatest() {
        showWeeklyByIndex(summaryArticles.length - 1);
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
          showWeeklyById(jumpSelect.value);
        });
      }

      // ----- Deep links and browser history -----
      function hashValue() {
        return window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : '';
      }

      function weeklyIdFromHash() {
        const value = hashValue();
        if (!value) return null;
        if (value.indexOf('week-') === 0) return value;
        const element = document.getElementById(value);
        const article = element ? element.closest('.summary-item') : null;
        return article ? article.id : null;
      }

      function anchorFromHash() {
        const value = hashValue();
        if (!value || value.indexOf('week-') === 0) return null;
        return document.getElementById(value);
      }

      function highlightAnchor(element) {
        if (!element) return;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
        setTimeout(() => {
          element.style.backgroundColor = '';
        }, 1000);
      }

      function copyUpdateLink(anchorId) {
        const url = window.location.origin + window.location.pathname + '#' + anchorId;
        navigator.clipboard.writeText(url).then(() => {
          const element = document.getElementById(anchorId);
          if (element) {
            element.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
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
      if (summaryArticles.length === 0) {
        if (readerDate) readerDate.textContent = 'No summaries';
        if (readerPosition) readerPosition.textContent = '';
        updateReaderControls();
      } else {
        const hashId = weeklyIdFromHash();
        const hashAnchor = anchorFromHash();

        if (hashId) {
          // Keep update anchors intact, but normalize weekly links.
          showWeeklyById(hashId, { history: hashAnchor ? false : 'replace' });
          if (hashAnchor) {
            setTimeout(() => highlightAnchor(hashAnchor), 150);
          }
        } else {
          showWeeklyByIndex(summaryArticles.length - 1, { history: false });
        }
      }

      window.addEventListener('popstate', () => {
        const hashId = weeklyIdFromHash();
        if (hashId) {
          showWeeklyById(hashId, { history: false });
        } else if (summaryArticles.length > 0) {
          showWeeklyByIndex(summaryArticles.length - 1, { history: false });
        }
        const hashAnchor = anchorFromHash();
        if (hashAnchor) {
          setTimeout(() => highlightAnchor(hashAnchor), 100);
        }
      });
    </script>
</body>
</html>`;
};

const run = async () => {
  const args = process.argv.slice(2);
  const configFile = args[0];
  
  // Load configuration
  let config: SummaryConfig;
  try {
    config = await loadConfig(configFile);
    console.log(`Configuration ${configFile || 'default'} loaded successfully.`);
  } catch (error) {
    console.error('Failed to load configuration. Using defaults.');
    process.exit(1);
  }
  
  console.log('Generating weekly summaries...');
  console.log('Step 1/4: Scanning for daily summaries...');
  
  // Determine the base summaries directory
  const baseSummariesDir = path.join(process.cwd(), 'public', 'summaries');
  const summariesDir = config.outputPath 
    ? path.join(baseSummariesDir, config.outputPath)
    : baseSummariesDir;
  
  console.log(`  Reading from: ${summariesDir}`);
  
  try {
    const files = await fs.readdir(summariesDir);
    const htmlFiles = files
      .filter(file => file.match(/^\d{4}-\d{2}-\d{2}\.html$/))
      .sort();
    
    console.log(`✓ Found ${htmlFiles.length} daily summary files`);
    
    if (htmlFiles.length === 0) {
      console.error('No daily summaries found. Generate some daily summaries first.');
      process.exit(1);
    }
    
    console.log('Step 2/4: Parsing daily summaries...');
    const dailySummaries: DailySummaryData[] = [];
    
    for (const file of htmlFiles) {
      const date = file.replace('.html', '');
      const filePath = path.join(summariesDir, file);
      const summary = await parseDailySummary(filePath, date);
      
      if (summary) {
        dailySummaries.push(summary);
        console.log(`  ✓ Parsed ${date}`);
      }
    }
    
    console.log(`✓ Successfully parsed ${dailySummaries.length} daily summaries`);
    
    console.log('Step 3/5: Aggregating into weekly summaries...');
    const weeklyData = aggregateWeeklyData(dailySummaries);
    console.log(`✓ Created ${weeklyData.length} weekly summaries`);
    
    console.log('Step 4/5: Generating AI summaries for each week...');
    const weeklySummaries: Map<string, StructuredSummary> = new Map();
    const outputDir = summariesDir;
    let skippedCount = 0;
    let generatedCount = 0;
    
    for (const week of weeklyData) {
      const weekKey = `${week.year}-W${week.week}`;
      const weekFilename = `${weekKey}.html`;
      const weekPath = path.join(outputDir, weekFilename);
      
      // Check if file already exists
      try {
        await fs.access(weekPath);
        console.log(`  ⊘ Skipping ${weekKey} (file already exists)`);
        skippedCount++;
        continue;
      } catch {
        // File doesn't exist, proceed with generation
      }
      
      console.log(`  Generating summary for ${weekKey}...`);
      const summary = await generateWeeklySummaryWithAI(week, config);
      weeklySummaries.set(weekKey, summary);
      generatedCount++;
    }
    console.log(`✓ Generated ${generatedCount} new AI summaries (skipped ${skippedCount} existing)`);
    
    console.log('Step 5/5: Generating HTML files...');
    
    // Generate individual weekly pages for new summaries
    for (const week of weeklyData) {
      const weekKey = `${week.year}-W${week.week}`;
      const summary = weeklySummaries.get(weekKey);
      
      if (!summary) {
        // This was skipped, no need to regenerate
        continue;
      }
      
      const weekHtml = createWeeklyHtml(summary, week, weeklyData, config.outputPath || '');
      const weekFilename = `${weekKey}.html`;
      const weekPath = path.join(outputDir, weekFilename);
      await fs.writeFile(weekPath, weekHtml);
      console.log(`  ✓ Generated ${weekFilename}`);
    }
    
    // Generate weeklies index by reading all weekly HTML files
    console.log('\nGenerating weeklies.html index...');
    await updateWeekliesIndex(outputDir, config.outputPath || '');
    console.log(`✓ Generated weeklies.html index`);
    
    console.log('\n✅ All done! Weekly summaries generated successfully.');
    console.log(`   Output directory: ${outputDir}`);
    console.log(`   Generated: ${generatedCount} new weekly summaries`);
    console.log(`   Skipped: ${skippedCount} existing weekly summaries`);
    console.log(`   Total: ${weeklyData.length} weekly summaries`);
    console.log(`\nNote: Weekly summaries are placed alongside daily summaries.`);
    console.log(`View them at: ${path.join(outputDir, 'weeklies.html')}`);
    
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
