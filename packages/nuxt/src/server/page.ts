/**
 * Fallback editor page while `@bildr/editor` isn't built (T10): shows the
 * model summary and drift through the guarded API, and how to build the editor.
 */

/** The placeholder's own policy: its one inline script needs `'unsafe-inline'`. */
export const PAGE_CSP = 'default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; frame-ancestors \'self\''

export const editorPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>bildr</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; color: #1f2937; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  pre { background: #f3f4f6; padding: 1rem; border-radius: .5rem; overflow: auto; }
</style>
</head>
<body>
<h1>bildr</h1>
<p>The editor isn't built yet: run <code>pnpm build:editor</code> in the bildr repository, then reload. Model and drift of this project:</p>
<pre id="model">Loading…</pre>
<pre id="drift"></pre>
<script>
  const show = async (id, path) => {
    const response = await fetch(path, { credentials: 'same-origin' })
    document.getElementById(id).textContent = JSON.stringify(await response.json(), null, 2)
  }
  show('model', '/__bildr/api/model')
  show('drift', '/__bildr/api/drift')
</script>
</body>
</html>
`
