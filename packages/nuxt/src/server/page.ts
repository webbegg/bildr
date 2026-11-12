/**
 * Placeholder editor page until the editor UI moves into the module (T10):
 * shows the model summary and drift through the guarded API.
 */
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
<p>The visual editor arrives here. Model and drift of this project:</p>
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
