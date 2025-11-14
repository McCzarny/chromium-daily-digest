<div align="center">
<img width="250" height="250" alt="Chromium Daily Digest" src="./public/summaries/assets/daily-digest-logo.svg" />
</div>

# Chromium Daily Digest

To check the daily and weekly summaries go to: https://mcczarny.github.io/chromium-daily-digest/

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `SECRET_GEMINI_API_KEY` and `SECRET_GITHUB_TOKEN` in [.env.local](.env.local) to your Gemini API key and GitHub token respectively
3. Run the generator:
   ```bash
   # Generate daily summaries
   npm run generate-page [date] [branch] [config-file]
   
   # Generate weekly summaries from existing daily summaries
   npm run generate-weeklies [config-file]
   ```

### How It Works

This tool uses an **agentic AI approach** where the AI can:
- Dynamically fetch detailed commit information (diffs, patches, statistics) on demand
- Investigate specific commits when messages are unclear
- Analyze actual code changes for better accuracy
- Automatically chunk large commit sets to stay within context limits

**Examples:**
```bash
# Generate daily summaries
# Basic usage (no config)
npm run generate-page 2025-11-09 main

# With configuration file
npm run generate-page 2025-11-09 main config.example.json

# V8-focused summary
npm run generate-page 2025-11-09 main config.v8-focus.json

# Generate weekly summaries
# Basic usage (processes all daily summaries in public/summaries/)
npm run generate-weeklies

# With configuration file (uses outputPath to find daily summaries)
npm run generate-weeklies config.example.json
```

### Configuration

Create a JSON configuration file to customize the summary generation:

```json
{
  "customInstructions": "Your custom instructions for the AI",
  "interestingKeywords": "keyword1,keyword2,keyword3",
  "outputPath": "subfolder",
  "ignoredBotEmails": ["bot@example.com"],
  "focusAreas": ["V8", "Blink", "DevTools"]
}
```

**Configuration Options:**

- **`customInstructions`** (optional): Custom instructions to guide the AI summary generation. Use this to focus on specific aspects, filter certain types of changes, or emphasize particular areas of Chromium.

- **`interestingKeywords`** (optional): Comma-separated keywords that should be highlighted in the summary (e.g., "performance,security,v8").

- **`outputPath`** (optional): Subpath within `public/summaries/` where generated HTML pages should be saved. Empty string means root of `public/summaries`. Examples: `""` (default, saves to `public/summaries/`), `"on-top-of-chromium"` (saves to `public/summaries/on-top-of-chromium/`), `"v8-focus"` (saves to `public/summaries/v8-focus/`).

- **`ignoredBotEmails`** (optional): Additional bot email addresses to ignore beyond the default list.

- **`focusAreas`** (optional): Array of specific Chromium areas to focus on (e.g., ["V8 JavaScript Engine", "Blink Rendering", "DevTools"]).

**Example Config Files:**

See [`config.example.json`](config.example.json) for a general-purpose configuration and [`config.v8-focus.json`](config.v8-focus.json) for a V8-focused example.

**Key Features:**
- **Smart Investigation**: AI fetches commit details only when needed
- **Accurate Summaries**: Based on actual code changes, not just commit messages
- **Automatic Chunking**: Handles large commit sets (500+) by processing in chunks
- **Better Grouping**: Groups related commits by analyzing actual file changes

### Weekly Summaries

The `generate-weeklies` script uses AI to create focused weekly summaries from existing daily digests:

**Features:**
- **AI-Powered Summarization**: Uses Gemini AI to analyze and condense daily summaries
- **Intelligent Filtering**: Skips less relevant changes to keep weekly summaries focused
- **Smart Grouping**: Combines related changes across multiple days into coherent themes
- **Breaking Changes Highlighted**: Emphasizes important breaking changes across the week
- **Same Color Scheme**: Matches daily summaries (sky blue accents) with a green header border
- **Integrated Output**: Weekly summaries are placed alongside daily summaries in the same directory

**How it works:**
1. Scans `public/summaries/` (or custom `outputPath` from config) for daily HTML files
2. Parses each daily summary to extract all content
3. Groups summaries by ISO week number
4. Sends daily content to Gemini AI to generate a focused weekly summary
5. Generates individual weekly HTML pages in the same directory as daily summaries

**Output:**
- Weekly pages: `public/summaries/{year}-W{week}.html` (e.g., `2025-W46.html`)
- Files are placed alongside daily summaries (e.g., `2025-11-09.html`, `2025-11-10.html`, etc.)

**Requirements:**
- Requires `SECRET_GEMINI_API_KEY` environment variable (same as daily generation)
- Must have existing daily summaries to process
