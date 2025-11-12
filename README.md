<div align="center">
<img width="250" height="250" alt="Chromium Daily Digest" src="./public/summaries/assets/daily-digest-logo.svg" />
</div>

# Chromium Daily Digest

To check the daily summaries go to: https://mcczarny.github.io/chromium-daily-digest/

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `SECRET_GEMINI_API_KEY` and `SECRET_GITHUB_TOKEN` in [.env.local](.env.local) to your Gemini API key and GitHub token respectively
3. Run the generator:
   ```bash
   npm run generate-page [date] [branch] [config-file]
   ```

### How It Works

This tool uses an **agentic AI approach** where the AI can:
- Dynamically fetch detailed commit information (diffs, patches, statistics) on demand
- Investigate specific commits when messages are unclear
- Analyze actual code changes for better accuracy
- Automatically chunk large commit sets to stay within context limits

**Examples:**
```bash
# Basic usage (no config)
npm run generate-page 2025-11-09 main

# With configuration file
npm run generate-page 2025-11-09 main config.example.json

# V8-focused summary
npm run generate-page 2025-11-09 main config.v8-focus.json
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
