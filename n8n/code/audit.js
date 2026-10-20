// n8n Code node (Run Once for All Items): SEO audit of every fetched page.
const cfg = $('Config').first().json;
const keywords = String(cfg.keywords).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const urls = $('Expand URLs').all().map(i => i.json.url);
const fetched = $('Fetch Page').all();
const speed = $('PageSpeed').all();
const sd = $getWorkflowStaticData('global');
sd.history = sd.history || {};

const strip = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i')); return m ? (m[2] ?? m[3]) : null; };
const metaTags = html => html.match(/<meta\b[^>]*>/gi) || [];
const meta = (html, key, val) => { for (const t of metaTags(html)) { if ((attr(t, key) || '').toLowerCase() === val) return attr(t, 'content'); } return null; };
const linkTag = (html, rel) => { for (const t of html.match(/<link\b[^>]*>/gi) || []) { if ((attr(t, 'rel') || '').toLowerCase() === rel) return attr(t, 'href'); } return null; };

async function probe(url) {
  try {
    const r = await this.helpers.httpRequest({ url, returnFullResponse: true, ignoreHttpStatusCode: true, json: false, timeout: 20000 });
    return { status: r.statusCode, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) };
  } catch (e) { return { status: 0, body: '' }; }
}

const results = [];
for (let i = 0; i < urls.length; i++) {
  const url = urls[i];
  const f = fetched[i] ? fetched[i].json : {};
  const status = f.statusCode || 0;
  const html = typeof f.data === 'string' ? f.data : '';
  const origin = new URL(url).origin;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  const desc = meta(html, 'name', 'description') || '';
  const canonical = linkTag(html, 'canonical');
  const h1s = html.match(/<h1\b[\s\S]*?<\/h1>/gi) || [];
  const h1Text = h1s.length ? strip(h1s[0]).toLowerCase() : '';
  const robotsMeta = (meta(html, 'name', 'robots') || '').toLowerCase();
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter(t => !(attr(t, 'alt') || '').trim()).length;
  const text = strip(html);
  const words = text ? text.split(' ').length : 0;
  const hrefs = (html.match(/<a\b[^>]*href\s*=\s*["'][^"']+["']/gi) || []).map(a => attr(a, 'href'));
  const internal = hrefs.filter(h => h.startsWith('/') || h.startsWith(origin)).length;
  const external = hrefs.filter(h => /^https?:\/\//.test(h) && !h.startsWith(origin)).length;
  let jsonldOk = false, jsonldCount = 0;
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    jsonldCount++; try { JSON.parse(m[1]); jsonldOk = true; } catch (e) { jsonldOk = false; break; }
  }
  const kwInTitle = keywords.some(k => title.toLowerCase().includes(k));
  const kwInH1 = keywords.some(k => h1Text.includes(k));
  const kwInDesc = keywords.some(k => desc.toLowerCase().includes(k));
  const robots = await probe.call(this, origin + '/robots.txt');
  const sitemap = await probe.call(this, origin + '/sitemap.xml');
  const robotsOk = robots.status === 200 && /user-agent/i.test(robots.body);
  const sitemapOk = sitemap.status === 200 && /<urlset|<sitemapindex/i.test(sitemap.body);
  const sitemapListsPage = sitemapOk && sitemap.body.includes(url.replace(/\/$/, ''));

  const checks = [
    ['Page returns HTTP 200', status === 200, 10, 'Status was ' + status],
    ['Title 30-60 characters', title.length >= 30 && title.length <= 60, 8, 'Title is ' + title.length + ' characters'],
    ['Keyword in title', kwInTitle, 6, 'None of the target keywords appear in the title'],
    ['Meta description 70-160 characters', desc.length >= 70 && desc.length <= 160, 8, 'Description is ' + desc.length + ' characters'],
    ['Keyword in meta description', kwInDesc, 3, 'No target keyword in the description'],
    ['Canonical link present', !!canonical, 6, 'Missing <link rel="canonical">'],
    ['Exactly one H1', h1s.length === 1, 6, 'Found ' + h1s.length + ' H1 tags'],
    ['Keyword in H1', kwInH1, 4, 'No target keyword in the H1'],
    ['Indexable (no noindex)', !robotsMeta.includes('noindex'), 10, 'Robots meta contains noindex'],
    ['Open Graph title, description, image', !!(meta(html, 'property', 'og:title') && meta(html, 'property', 'og:description') && meta(html, 'property', 'og:image')), 5, 'Missing og:title, og:description or og:image'],
    ['Twitter card', !!meta(html, 'name', 'twitter:card'), 2, 'Missing twitter:card'],
    ['Valid JSON-LD structured data', jsonldOk, 8, jsonldCount ? 'JSON-LD present but invalid' : 'No JSON-LD structured data'],
    ['Viewport meta (mobile)', !!meta(html, 'name', 'viewport'), 4, 'Missing viewport meta'],
    ['html lang attribute', /<html[^>]*\blang\s*=/i.test(html), 2, 'Missing lang on <html>'],
    ['Images have alt text', imgsNoAlt === 0, 3, imgsNoAlt + ' image(s) without alt'],
    ['At least 300 words of text', words >= 300, 5, 'Only ' + words + ' words'],
    ['3+ internal links', internal >= 3, 3, 'Only ' + internal + ' internal links'],
    ['Links to an authoritative external source', external >= 1, 2, 'No external links'],
    ['robots.txt reachable', robotsOk, 4, origin + '/robots.txt returned ' + robots.status],
    ['sitemap.xml reachable', sitemapOk, 5, origin + '/sitemap.xml returned ' + sitemap.status],
    ['Page listed in sitemap', sitemapListsPage, 4, 'Page URL not found in sitemap.xml']
  ].map(([name, pass, weight, detail]) => ({ name, pass: !!pass, weight, detail }));

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.filter(c => c.pass).reduce((a, c) => a + c.weight, 0);
  const score = Math.round((got / total) * 100);
  const lh = (speed[i] && speed[i].json && speed[i].json.lighthouseResult && speed[i].json.lighthouseResult.categories) || {};
  const prev = sd.history[url];
  sd.history[url] = { score, at: new Date().toISOString() };
  results.push({
    url, status, score,
    previousScore: prev ? prev.score : null,
    delta: prev ? score - prev.score : null,
    lighthouse: { seo: lh.seo ? Math.round(lh.seo.score * 100) : null, performance: lh.performance ? Math.round(lh.performance.score * 100) : null },
    failing: checks.filter(c => !c.pass),
    passing: checks.filter(c => c.pass).map(c => c.name)
  });
}
return [{ json: { results, avgScore: Math.round(results.reduce((a, r) => a + r.score, 0) / (results.length || 1)), runAt: new Date().toISOString() } }];
