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
   `npm run generate-page [date] [branch]`
