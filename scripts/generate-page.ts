import { fetchCommitsForDate } from '../services/chromiumService';
import { generateSummary } from '../services/geminiService';
import { GitilesCommit, StructuredSummary } from '../types';
import fs from 'fs/promises';
import path from 'path';

const GITHUB_COMMIT_URL = 'https://github.com/chromium/chromium/commit/';

const createHtmlPage = (
  summary: StructuredSummary, 
  allCommits: GitilesCommit[], 
  filteredCommits: GitilesCommit[], 
  date: string, 
  branch: string
): string => {

  const renderOverview = (text: string): string => {
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
      const hash = url.split('/').pop() ?? '';
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-sky-500 hover:text-sky-300 font-mono">(${hash.substring(0, 7)})</a>`;
    });
  };

  const renderPointText = (text: string): string => {
    return text.replace(/`([^`]+)`/g, `<code class="bg-gray-700 text-pink-400 rounded px-2 py-1 text-sm font-mono">$1</code>`);
  };

  const categoriesHtml = summary.categories.map(category => `
    <div>
      <h3 class="text-2xl font-semibold text-sky-400 mt-6 mb-4">${category.title}</h3>
      <ul class="list-disc list-inside space-y-3">
        ${category.points.map(point => `
          <li class="text-gray-300">
            ${renderPointText(point.text)}
            ${point.commits.map(hash => `
              <a href="${GITHUB_COMMIT_URL}${hash}" target="_blank" rel="noopener noreferrer" class="text-sky-500 hover:text-sky-300 text-xs ml-2 font-mono">(${hash.substring(0, 7)})</a>
            `).join('')}
          </li>
        `).join('')}
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
    <link rel="icon" type="image/svg+xml" href="../assets/daily-digest-logo.svg" />
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
          <img src="../assets/daily-digest-logo.svg" alt="Chromium Daily Digest Logo" class="h-8 w-8" />
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
</body>
</html>`;
};

const updateIndexPage = async (outputDir: string) => {
    const files = await fs.readdir(outputDir);
    const summaryPages = files
      .filter(file => file.endsWith('.html') && file !== 'index.html')
      .sort()
      .reverse();
    
    console.log(`  Found ${summaryPages.length} summary pages`);

    // Read all summary files and extract their content
    const summaries = await Promise.all(
      summaryPages.map(async (page) => {
        const date = page.replace('.html', '');
        const filePath = path.join(outputDir, page);
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Extract the entire summary content (title, overview, and all categories)
        const titleMatch = content.match(/<h2 class="text-3xl font-bold text-white mb-6">(.*?)<\/h2>/s);
        const overviewSectionMatch = content.match(/<div class="bg-gray-800 p-4 rounded-lg mb-6 shadow-inner border border-gray-700">(.*?)<\/div>\s*<\/div>/s);
        const categoriesSectionMatch = content.match(/<\/div>\s*<\/div>\s*(<div>.*?)<details class="mt-12/s);
        
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
    <link rel="icon" type="image/svg+xml" href="../assets/daily-digest-logo.svg" />
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
          <img src="../assets/daily-digest-logo.svg" alt="Chromium Daily Digest Logo" class="h-10 w-10" />
          <div>
            <h1 class="text-3xl font-bold text-white tracking-tight">Chromium Daily Summaries</h1>
            <p class="text-gray-400 mt-1">Latest Chromium commits summarized daily</p>
          </div>
        </div>
      </div>
    </header>
    <main class="container mx-auto px-4 py-8">
      <div id="summaries-container" class="space-y-8">
        ${summaries.length === 0 ? '<p class="text-gray-400">No summaries generated yet.</p>' : summaries.map((summary, idx) => `
        <article class="summary-item bg-gray-800 rounded-lg shadow-lg border border-gray-700" data-page="${Math.floor(idx / ITEMS_PER_PAGE) + 1}">
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
    </script>
</body>
</html>`;

    await fs.writeFile(path.join(outputDir, 'index.html'), indexContent);
    console.log('✓ Index page updated with inline summaries and pagination');
};


const run = async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: tsx scripts/generate-page.ts <date> <branch> [interesting-keywords]');
    process.exit(1);
  }

  const [date, branch, interestingKeywords = ''] = args;
  
  // Bot author emails to ignore
  const IGNORED_BOT_EMAILS = [
    'bling-autoroll-builder@chops-service-accounts.iam.gserviceaccount.com',
    'chromeos-ci-prod@chromeos-bot.iam.gserviceaccount.com',
    'chromium-autoroll@skia-public.iam.gserviceaccount.com',
    'chromium-internal-autoroll@skia-corp.google.com.iam.gserviceaccount.com',
    'mdb.chrome-pki-metadata-release-jobs@google.com',
  ];
  
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
    console.log('Step 3/5: Generating summary with Gemini AI...');

    const summaryContent = await generateSummary(
      filteredCommits, 
      interestingKeywords, 
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

    const fullHtml = createHtmlPage(summaryContent, allCommits, filteredCommits, date, branch);
    
    const outputDir = path.join(process.cwd(), 'public', 'summaries');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `${date}.html`);
    await fs.writeFile(outputPath, fullHtml);
    console.log(`✓ Summary page saved to: ${outputPath}`);
    
    console.log('Step 5/5: Updating index page...');
    await updateIndexPage(outputDir);
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
