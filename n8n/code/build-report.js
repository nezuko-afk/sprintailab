// n8n Code node (Run Once for All Items): build the email and the GitHub issue from audit + AI suggestions.
const audit = $('Audit').first().json;
const ai = ($('AI Suggestions').first().json.content || []).map(c => c.text || '').join('\n').trim() || '(AI suggestions unavailable this run.)';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const arrow = d => d === null ? 'first run' : (d > 0 ? '+' + d + ' (up)' : d < 0 ? d + ' (down)' : 'no change');
const rows = audit.results.map(r => `<h3>${esc(r.url)}</h3>
<p>SEO score <b>${r.score}/100</b> (${arrow(r.delta)}). Lighthouse SEO: ${r.lighthouse.seo ?? 'n/a'}, performance: ${r.lighthouse.performance ?? 'n/a'}.</p>
${r.failing.length ? '<ul>' + r.failing.map(f => `<li><b>${esc(f.name)}</b>: ${esc(f.detail)}</li>`).join('') + '</ul>' : '<p>All checks pass.</p>'}`).join('\n');
const html = `<div style="font-family:system-ui,sans-serif;max-width:720px"><h2>Sprint AI Lab SEO report</h2>
<p>Average score: <b>${audit.avgScore}/100</b>. Run at ${audit.runAt}.</p>${rows}
<h3>Suggested next improvements (AI draft, review before applying)</h3><pre style="white-space:pre-wrap">${esc(ai)}</pre>
<p style="color:#666;font-size:12px">Automated weekly by the SEO autopilot workflow. Rankings are not guaranteed; this report measures on-page and technical SEO.</p></div>`;
const md = audit.results.map(r => `### ${r.url}\nScore **${r.score}/100** (${arrow(r.delta)})\n\n` + (r.failing.length ? r.failing.map(f => `- [ ] **${f.name}**: ${f.detail}`).join('\n') : 'All checks pass.')).join('\n\n') + '\n\n### Suggested improvements (AI draft, review before applying)\n' + ai;
const anyFail = audit.results.some(r => r.failing.length > 0);
return [{ json: { subject: `[Sprint AI Lab SEO] avg ${audit.avgScore}/100 - ${anyFail ? audit.results.reduce((a, r) => a + r.failing.length, 0) + ' issue(s) to fix' : 'all clear'}`, html, issueTitle: `SEO autopilot: ${audit.runAt.slice(0, 10)} (avg ${audit.avgScore}/100)`, issueBody: md, anyFail } }];
