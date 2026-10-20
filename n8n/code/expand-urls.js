// n8n Code node (Run Once for All Items): validate config, emit one item per page URL.
const cfg = $('Config').first().json;
const placeholders = Object.entries(cfg).filter(([, v]) => String(v).includes('REPLACE_')).map(([k]) => k);
if (placeholders.length) {
  throw new Error('Fill in the Config node first. Still placeholders: ' + placeholders.join(', '));
}
return String(cfg.urls).split(',').map(u => u.trim()).filter(Boolean).map(url => ({ json: { url } }));
