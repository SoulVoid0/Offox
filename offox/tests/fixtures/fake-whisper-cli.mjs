#!/usr/bin/env node
/* Stand-in for whisper.cpp's whisper-cli used by the tests: checks that it
 * gets a 16 kHz mono WAV and the usual options, and writes a small .vtt.
 * With -l auto it "detects" German. */
import fs from "node:fs";

let args = process.argv.slice(2);
let opt = name => { let i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
let model = opt("-m"), audio = opt("-f"), lang = opt("-l"), out = opt("-of");
if (!model || !fs.existsSync(model)) { console.error("error: failed to load model"); process.exit(3); }
let wav = fs.readFileSync(audio);
if (wav.toString("latin1", 0, 4) !== "RIFF" || wav.readUInt32LE(24) !== 16000 || wav.readUInt16LE(22) !== 1) {
  console.error("error: input is not 16 kHz mono WAV");
  process.exit(4);
}
if (!args.includes("-ovtt")) { console.error("error: no -ovtt"); process.exit(5); }
let seconds = (wav.length - 44) / 32000;
if (lang === "auto") { console.error("whisper_full_with_state: auto-detected language: de (p = 0.93)"); lang = "de"; }
let text = args.includes("-tr") ? "Translated speech" : `Speech in ${lang}`;
console.error("whisper_print_progress_callback: progress =  50%");
console.log(`[00:00:00.000 --> 00:00:01.500]   ${text} one`);
fs.writeFileSync(out + ".vtt", `WEBVTT\n\n00:00:00.000 --> 00:00:01.500\n${text} one\n\n00:00:01.500 --> ${seconds >= 3 ? "00:00:03.000" : "00:00:02.000"}\n${text} two\n\n`);
fs.writeFileSync(out + ".args.json", JSON.stringify({ args, cwd: process.cwd() }));
console.error("whisper_print_progress_callback: progress = 100%");
