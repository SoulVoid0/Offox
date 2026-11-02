# Offox

**Offox** is an offline web browser based on Mozilla Firefox. It never connects to the internet. Instead, every website it shows is a folder on your computer or on an external drive.

## How it works

You choose one or more *storage folders* in Offox's settings (`about:offox`). Each website is a sub folder containing normal HTML, CSS and JavaScript files plus a small `offox-site.json` file that says which address the website answers to, for example `https://wikipedia.org`.

When you type that address, Offox reads the files from the folder instead of the network. Because no request ever leaves the computer, you can give your sites any address you like.

## Built-in websites

The first time a storage folder is chosen, Offox creates:

| Website | Address | Template |
|---|---|---|
| OffTube | https://youtube.com | Video sharing |
| {{SITE_TITLE}} | https://{{SITE_DOMAIN}} | Encyclopedia |
| Software Store | https://software.store | Software storage |

More websites can be created from templates: blog, photo gallery, music library, document library, file drive and a blank site.

## FireLine

**FireLine** is the search engine built into Offox and the only one it has. It indexes every website in every storage folder, so you can find a site again even if you forgot its address. Open it at https://fireline.offox/ or type words into the address bar.

## See also

- [[Main Page]]
- [[Editing help]]
