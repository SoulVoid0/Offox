# The Offox site API

Every Offox website can read and change the files in **its own folder** from
JavaScript. This is how OffTube stores uploads, how the wiki saves articles and
how Docs autosaves. Add the script to a page:

```html
<script src="/__offox/offox.js"></script>
<script>
  await Offox.writeText("notes/hello.txt", "Hi!");
  let text = await Offox.readText("notes/hello.txt");
</script>
```

Paths are relative to the site folder (`videos/abc123/title.txt`). `..` is
refused, and `offox-site.json` can only be changed in `about:offox`. Only pages
of the same site, at its address or one of its other addresses, may call the
API. Requests from other sites are refused.

| Call | What it does |
|---|---|
| `Offox.url(path)` | URL of a file, for `src`/`href` |
| `Offox.info()` | `{domain, origin, title, description, template, created}` |
| `Offox.sites()` | every website (same list as FireLine) |
| `Offox.search(q)` | FireLine results `{query, total, results:[{url, title, site, kind, snippet}]}` |
| `Offox.stat(path)` | `{exists, type: "file"/"directory", size, lastModified}` |
| `Offox.exists(path)` | `true`/`false` |
| `Offox.list(path = "")` | `[{name, type, size, modified}]` |
| `Offox.collect(dir, files)` | reads the small `files` of every sub-folder of `dir` in one call, e.g. `collect("videos", ["title.txt", "created.txt"])` |
| `Offox.readText(path, fallback?)` / `Offox.readJSON(path, fallback?)` | read a file |
| `Offox.write(path, blobOrBytes, {offset?})` | write a file (parent folders are created). With `offset`, appends at that position; the call fails if the file is not exactly that long |
| `Offox.writeText(path, text)` / `Offox.writeJSON(path, value)` | write text / pretty JSON |
| `Offox.upload(path, file, {onProgress, chunkSize})` | copies a `File` in 8 MB chunks, for any size |
| `Offox.mkdir(path)` / `Offox.remove(path)` / `Offox.move(from, to)` | folders, delete (recursive), rename |
| `Offox.id(length = 11)` | random YouTube-style id |
| `Offox.media.info()` | `{ffmpeg: bool, path}` |
| `Offox.media.convert(path, {output?})` | starts converting a video/audio file to a playable format and returns `{id, state}` |
| `Offox.media.job(id)` | `{state: "probing"/"running"/"done"/"failed", progress, output, outputName, error}` |
| `Offox.media.convertAndWait(path, {onProgress})` | both of the above, resolves when done |

## Raw HTTP

The script is a thin wrapper around `https://<site>/__offox/api/<name>`:

- `GET`: `info`, `stat?path=`, `list?path=`, `collect?path=&files=a,b`, `sites`,
  `search?q=`, `media/info`, `media/job?id=`
- `POST` or `PUT` (the body is the file content): `write?path=[&offset=n|&append]`,
  `mkdir?path=`, `delete?path=`, `move?from=&to=`, `media/convert?path=[&output=]`

Answers are JSON. Errors look like `{"error": "..."}` with a 4xx/5xx status.

## Static files

Everything else under a site's address is served from its folder:

- `/` serves `index.html`. `/about` serves `about.html` or `about/index.html`.
- If a page is missing, the site's own `404.html` is used when it exists.
- A folder without an `index.html` gets a simple file listing.
- `?download` or `?download=name.ext` makes the browser save the file.
- `Range` requests are supported, so videos can be seeked.

## FireLine and your site

FireLine indexes every `.html` page of a site, using its `<title>`, its
`<meta name="description">` and its text. To hide a page, add
`<meta name="fireline" content="noindex">`. To index data, give the site
`searchRules` in `offox-site.json`:

```json
"searchRules": [
  { "type": "folders", "dir": "videos", "url": "/watch.html?v={name}",
    "title": "title.txt", "text": ["description.txt"], "kind": "video" },
  { "type": "files", "dir": "posts", "ext": ".md", "url": "/post.html?p={stem}", "kind": "post" },
  { "type": "folders", "dir": "apps", "json": "app.json", "titleKey": "name",
    "textKeys": ["summary", "tags"], "url": "/app.html?id={name}", "kind": "app" }
]
```

`{name}` is the folder or file name, and `{stem}` is the file name without its
extension. For `files` rules, the title comes from a `title:` line in the front
matter or from the first `# heading`.
