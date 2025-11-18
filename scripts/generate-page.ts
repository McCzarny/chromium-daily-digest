import { fetchCommitsForDate } from '../services/chromiumService';
import { createLLMService } from '../services/llmService';
import { GitilesCommit, StructuredSummary, SummaryConfig } from '../types';
import { loadConfig, getIgnoredBotEmails } from '../config';
import { renderOverview, renderPointText, getAssetsPath, GITHUB_COMMIT_URL } from '../utils/htmlUtils';
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="${assetsPath}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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

const updateIndexPage = async (outputDir: string, outputSubpath: string) => {
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
      .reverse();
    
    console.log(`  Found ${summaryPages.length} daily summary pages`);

    // Read all summary files and extract their content
    const summaries = await Promise.all(
      summaryPages.map(async (page) => {
        const date = page.replace('.html', '');
        const filePath = path.join(outputDir, page);
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Extract the entire summary content (title, overview, and all categories)
        const titleMatch = content.match(/<h2 class="text-3xl font-bold text-white mb-6">(.*?)<\/h2>/s);
        const overviewSectionMatch = content.match(/<div class="bg-gray-800 p-4 rounded-lg mb-6 shadow-inner border border-gray-700">(.*?)<\/div>/s);
        // Capture all category sections between overview and the "All Commits" details section
        const categoriesSectionMatch = content.match(/<\/div>\s*<\/div>\s*((?:<div>[\s\S]*?<\/div>\s*)+)<details class="mt-12/s);
        
        const title = titleMatch ? titleMatch[1] : 'Summary';
        const overviewSection = overviewSectionMatch ? overviewSectionMatch[1] : '';
        const categoriesSection = categoriesSectionMatch ? categoriesSectionMatch[1] : '';
        
        return { date, page, title, overviewSection, categoriesSection };
      })
    );
    
    console.log(`  Processed ${summaries.length} summaries`);

    const ITEMS_PER_PAGE = 20;
    const totalPages = Math.ceil(summaries.length / ITEMS_PER_PAGE);
    console.log(`  Creating index with ${totalPages} page(s) (${ITEMS_PER_PAGE} items per page)`);

    const indexContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="${assetsPath}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chromium Summaries</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .summary-item { display: none; }
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
    <main class="container mx-auto px-4 py-8">
      <div class="mb-6 text-center">
        <a href="./weeklies.html" class="text-green-500 hover:text-green-300 text-lg font-semibold">📅 View Weekly Summaries →</a>
      </div>
      <div id="summaries-container" class="space-y-8">
        ${summaries.length === 0 ? '<p class="text-gray-400">No summaries generated yet.</p>' : summaries.map((summary, idx) => `
        <article id="summary-${summary.date}" class="summary-item bg-gray-800 rounded-lg shadow-lg border border-gray-700" data-page="${Math.floor(idx / ITEMS_PER_PAGE) + 1}">
          <div class="bg-gray-900/50 p-4 rounded-t-lg border-b border-gray-700 flex justify-between items-center">
            <h2 class="text-2xl font-bold text-white">${summary.date}</h2>
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
        
        // Only update pagination controls if they exist
        const currentPageEl = document.getElementById('current-page');
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        
        if (currentPageEl) currentPageEl.textContent = page;
        if (prevBtn) prevBtn.disabled = page === 1;
        if (nextBtn) nextBtn.disabled = page === totalPages;
        
        // Scroll to top
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
      
      // Initialize
      showPage(1);

      function copySummaryLink(date) {
        const url = \`\${window.location.origin}\${window.location.pathname}#summary-\${date}\`;
        navigator.clipboard.writeText(url).then(() => {
          // Optionally show a toast or feedback
        });
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
      
      // Scroll to anchor if present in URL
      if (window.location.hash) {
        setTimeout(() => {
          const element = document.getElementById(window.location.hash.substring(1));
          if (element) {
            // Find which page this element is on
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
              element.style.backgroundColor = 'rgba(14, 165, 233, 0.1)';
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

    await fs.writeFile(path.join(outputDir, 'index.html'), indexContent);
    console.log('✓ Index page updated with inline summaries and pagination');
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

run();
