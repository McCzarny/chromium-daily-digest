import { SummaryConfig, StructuredSummary } from '../types';
import { loadConfig } from '../config';
import { createLLMService, DailySummaryData } from '../services/llmService';
import { renderOverview, renderPointText, getAssetsPath, GITHUB_COMMIT_URL } from '../utils/htmlUtils';
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
          text = text.replace(/⚠️\s*BREAKING\s*/g, '').trim();
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
        
        points.push({ text, isBreaking, commits });
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
            ${point.isBreaking ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-900 text-red-200 border border-red-700 mr-2">⚠️ BREAKING</span>` : ''}
            ${renderPointText(point.text)}
            ${point.commits.map(hash => `
              <a href="${GITHUB_COMMIT_URL}${hash}" target="_blank" rel="noopener noreferrer" class="text-sky-500 hover:text-sky-300 text-xs ml-2 font-mono">(${hash.substring(0, 7)})</a>
            `).join('')}
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

const updateWeekliesIndex = async (outputDir: string, outputSubpath: string) => {
  const assetsPath = getAssetsPath(outputSubpath, 'weekly-digest-logo.svg');
  
  const files = await fs.readdir(outputDir);
  // Only include weekly summaries matching YYYY-WNN.html pattern
  const weeklyPattern = /^\d{4}-W\d{1,2}\.html$/;
  const weeklyPages = files
    .filter(file => weeklyPattern.test(file))
    .sort()
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

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(weeklies.length / ITEMS_PER_PAGE);
  console.log(`  Creating weeklies index with ${totalPages} page(s) (${ITEMS_PER_PAGE} items per page)`);

  const indexContent = createWeekliesIndexHtml(weeklies, assetsPath, ITEMS_PER_PAGE, totalPages);
  
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
  ITEMS_PER_PAGE: number, 
  totalPages: number
): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="${assetsPath}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chromium Weekly Summaries</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .summary-item { display: none; }
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
    <main class="container mx-auto px-4 py-8">
      <div class="mb-6 text-center">
        <a href="./index.html" class="text-green-500 hover:text-green-300 text-lg font-semibold">📄 View Daily Summaries →</a>
      </div>
      <div id="summaries-container" class="space-y-8">
        ${weeklies.length === 0 ? '<p class="text-gray-400">No weekly summaries generated yet.</p>' : 
          weeklies.map((weekly, idx) => `
        <article id="week-${weekly.year}-${weekly.week}" class="summary-item bg-gray-800 rounded-lg shadow-lg border border-green-800" data-page="${Math.floor(idx / ITEMS_PER_PAGE) + 1}">
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
      
      ${totalPages > 1 ? `
      <div class="mt-8 flex justify-center items-center gap-2">
        <button id="prev-btn" class="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
          ← Previous
        </button>
        <span id="page-info" class="text-gray-300 mx-4">Page <span id="current-page">1</span> of ${totalPages}</span>
        <button id="next-btn" class="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
          Next →
        </button>
      </div>
      ` : ''}
    </main>
    
    <script>
      const ITEMS_PER_PAGE = ${ITEMS_PER_PAGE};
      const totalPages = ${totalPages};
      let currentPage = 1;
      
      function showPage(page) {
        const items = document.querySelectorAll('.summary-item');
        items.forEach(item => {
          if (parseInt(item.dataset.page) === page) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
        
        const currentPageEl = document.getElementById('current-page');
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        
        if (currentPageEl) currentPageEl.textContent = page;
        if (prevBtn) prevBtn.disabled = page === 1;
        if (nextBtn) nextBtn.disabled = page === totalPages;
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      
      document.getElementById('prev-btn')?.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          showPage(currentPage);
        }
      });
      
      document.getElementById('next-btn')?.addEventListener('click', () => {
        if (currentPage < totalPages) {
          currentPage++;
          showPage(currentPage);
        }
      });
      
      showPage(1);
      
      if (window.location.hash) {
        setTimeout(() => {
          const element = document.getElementById(window.location.hash.substring(1));
          if (element) {
            const article = element.closest('.summary-item');
            if (article) {
              const page = parseInt(article.dataset.page);
              if (page !== currentPage) {
                currentPage = page;
                showPage(currentPage);
              }
            }
            
            setTimeout(() => {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              element.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
              setTimeout(() => {
                element.style.backgroundColor = '';
              }, 1000);
            }, 100);
          }
        }, 100);
      }
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

run();
