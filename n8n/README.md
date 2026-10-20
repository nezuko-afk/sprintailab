# SEO autopilot (n8n)

Importable workflow: `seo-autopilot.json`. It audits the two Sprint AI Lab pages every Monday 9:00 IST (and on demand), keeps score history between runs, asks an AI for prioritised fixes, emails the team, and opens a GitHub issue with a checklist.

Pages covered:
- https://www.sprintailab.com/app/governed-ai-reverse-engineering.html
- https://nezuko-afk.github.io/sprintailab/ (canonical points to the page above)

## What each run does

1. Fetches both pages and checks 21 on-page and technical signals (HTTP status, title and description length and keywords, canonical, one H1, noindex, Open Graph, JSON-LD validity, mobile viewport, image alt text, word count, links, robots.txt, sitemap.xml and whether the page is listed in it).
2. Calls Google PageSpeed Insights (mobile) for Lighthouse SEO and performance scores.
3. Scores each page 0 to 100 and compares with the previous run, so you can see if it is improving.
4. Sends the AI the audit and gets at most 8 concrete fixes (no keyword stuffing, no link schemes, no ranking promises).
5. Emails the report from the support address to Pritam, Suresh and Sameer.
6. If anything fails, opens a GitHub issue with a checklist. A person applies the changes; nothing is published automatically.
7. If the workflow itself fails, an error email goes to the same three people.

## Set up

1. In n8n: Workflows, Import from file, choose `seo-autopilot.json`.
2. Check the **Config** node: sender is pritampatil@sprintailab.com; recipients are pritampatil@, sureshinchur@ and sameerk@sprintailab.com. **Email Error Notice** uses the same addresses.
3. Create three credentials:
   - **SMTP** for the support mailbox (host, port, user, app password) and attach it to both email nodes.
   - **Header Auth** for Anthropic: name `x-api-key`, value your API key. Attach it to **AI Suggestions**. Optional: delete that node and the report still works without suggestions.
   - **GitHub** token with Issues write on `nezuko-afk/sprintailab`. Attach it to **Open GitHub Issue**.
4. Click **Run Now (manual)** once and check the email. Then switch the workflow to Active.

## Deploy the fixes on sprintailab.com

The workflow found these on the live site, and the fixes are ready in `seo/sprintailab.com/`:

| File | Put it at | Why |
| --- | --- | --- |
| `robots.txt` | `https://www.sprintailab.com/robots.txt` | The URL currently returns an error instead of rules |
| `sitemap.xml` | `https://www.sprintailab.com/sitemap.xml` | Same; also lists the page for crawlers |
| `jsonld-snippet.html` | inside `<head>` of the page | The page has no structured data |

After deploying, submit the sitemap in Google Search Console and Bing Webmaster Tools. That is also the only reliable way to see real rankings and clicks.

## Limits

- Nobody can guarantee a top ranking. This workflow measures and improves on-page and technical SEO; ranking also depends on backlinks, content quality and competition.
- "Keeps improving" means it finds regressions, tracks the score and proposes fixes. People approve and apply them.
- Rankings per keyword need Google Search Console (OAuth) or a paid rank API. Add a Search Console node later if you want clicks and positions in the email.
