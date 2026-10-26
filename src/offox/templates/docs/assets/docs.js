/* Docs – documents/<id>/document.html (the document body) + documents/<id>/meta.json {title, created, updated}
 * Pictures are stored next to the document in documents/<id>/images/. */
"use strict";
const SITE_TITLE = "{{SITE_TITLE}}";

const STARTERS = {
  letter: { name: "Letter", html: `<p>Your Name<br>Street 1<br>City</p><p><br></p><p>${new Date().toLocaleDateString()}</p><p><br></p><p>Dear …,</p><p><br></p><p>Write your letter here.</p><p><br></p><p>Kind regards,</p><p>Your Name</p>` },
  resume: { name: "Résumé", html: `<h1>Your Name</h1><p>email@example.com · Phone · City</p><h2>Experience</h2><h3>Job title — Company</h3><p><i>2020 – present</i></p><ul><li>What you did</li><li>What you achieved</li></ul><h2>Education</h2><h3>Degree — School</h3><p><i>2016 – 2020</i></p><h2>Skills</h2><ul><li>Skill one</li><li>Skill two</li></ul>` },
  notes: { name: "Meeting notes", html: `<h1>Meeting notes</h1><p><b>Date:</b> ${new Date().toLocaleDateString()}</p><p><b>Attendees:</b> </p><h2>Agenda</h2><ol><li></li></ol><h2>Notes</h2><p></p><h2>Action items</h2><ul><li>☐ </li></ul>` },
  report: { name: "Report", html: `<h1>Report title</h1><p><i>Author · ${new Date().toLocaleDateString()}</i></p><h2>Summary</h2><p>A short overview.</p><h2>Introduction</h2><p></p><h2>Findings</h2><table><tbody><tr><th>Item</th><th>Value</th></tr><tr><td></td><td></td></tr></tbody></table><h2>Conclusion</h2><p></p>` },
};

const Docs = {
  async list() {
    let items = await Offox.collect("documents", ["meta.json"]);
    return items.map(i => {
      let meta = {};
      try { meta = JSON.parse(i.files["meta.json"] || "{}"); } catch (e) {}
      return { id: i.name, title: meta.title || "Untitled document", updated: meta.updated || new Date(i.modified).toISOString(), meta };
    }).sort((a, b) => new Date(b.updated) - new Date(a.updated));
  },
  async create(title, html) {
    let id = Offox.id(10);
    let now = new Date().toISOString();
    await Offox.writeText(`documents/${id}/document.html`, html || "<p><br></p>");
    await Offox.writeJSON(`documents/${id}/meta.json`, { title: title || "Untitled document", created: now, updated: now });
    return id;
  },
};
