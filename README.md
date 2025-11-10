<div align="center">
<img width="1200" height="475" alt="Chromium Daily Digest" src="./public/assets/daily-digest-logo.svg" />
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
   npm run generate-page [date] [branch] [keywords]
   ```

### How It Works

This tool uses an **agentic AI approach** where the AI can:
- Dynamically fetch detailed commit information (diffs, patches, statistics) on demand
- Investigate specific commits when messages are unclear
- Analyze actual code changes for better accuracy
- Automatically chunk large commit sets to stay within context limits

**Examples:**
```bash
# Basic usage
npm run generate-page 2025-11-09 main

# With keywords to highlight
npm run generate-page 2025-11-09 main "performance,security"
```

**Key Features:**
- **Smart Investigation**: AI fetches commit details only when needed
- **Accurate Summaries**: Based on actual code changes, not just commit messages
- **Automatic Chunking**: Handles large commit sets (500+) by processing in chunks
- **Better Grouping**: Groups related commits by analyzing actual file changes
