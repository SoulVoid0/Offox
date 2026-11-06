# Video and audio formats

## Played directly

Offox uses the media engine of Firefox ESR 153, with Matroska (MKV) and HEVC
support turned on.

| Container | Video | Audio |
|---|---|---|
| MP4 / M4V / M4A / MOV (modern) | H.264, H.265/HEVC*, AV1, VP9 | AAC, MP3, Opus, FLAC |
| WebM | VP8, VP9, AV1 | Vorbis, Opus |
| MKV | H.264, HEVC*, VP8, VP9, AV1 | AAC, Opus, Vorbis, FLAC |
| Ogg / OGV | Theora | Vorbis, Opus, FLAC |
| — | — | MP3, WAV, FLAC, Opus files |

\* HEVC needs hardware or system support. On Windows that is the HEVC Video
Extensions. On Fedora it is a VA-API driver or ffmpeg-libs from RPM Fusion.

## Converted with FFmpeg

When you upload a video, OffTube first checks whether Offox can play it. If
not, or if you click **Convert** on a video's page, Offox runs FFmpeg:

1. **Remux, no quality loss.** If the streams are already playable (for
   example H.264 + AAC inside AVI or FLV, or HEVC in TS), they are copied into
   MP4 or WebM in seconds.
2. **Re-encode.** Otherwise (WMV, DivX/Xvid, MPEG-1/2, RealVideo, old
   QuickTime, 3GP, ...), the video is converted with the first encoder this
   FFmpeg has, in this order: VP9 (libvpx), AV1 (SVT-AV1 or libaom), H.264
   (OpenH264 or x264). Audio is converted to Opus or AAC.

The result is saved next to the original as `video.offox.webm` or
`video.offox.mp4`. The original is kept unless you delete it.

Offox looks for FFmpeg in this order:

1. the path chosen in `about:offox → Video formats`
2. `ffmpeg/ffmpeg.exe` or `ffmpeg.exe` next to the Offox program (the Windows
   installer can bundle it)
3. `/usr/bin`, `/usr/local/bin`, then the `PATH`

On Fedora, `sudo dnf install ffmpeg-free` covers VP9, AV1 and OpenH264. Install
`ffmpeg` from RPM Fusion for the most input formats.

## Why not VLC?

VLC's libraries are GPL/LGPL, and copying their code into a Firefox fork would
make Offox's licensing harder. For nearly every format, VLC itself relies on
FFmpeg's libavcodec. So Offox runs FFmpeg as a separate program and copies no
VLC code. The trade-off is that unusual formats are converted once when you
upload them, instead of being played directly. Playback then works in the normal
`<video>` element, with seeking, picture-in-picture and keyboard shortcuts.

## Subtitles and comments (OffTube)

Every video can have subtitles in any number of languages, stored as WebVTT
files in `videos/<id>/subtitles/`:

| File | Where it comes from |
|---|---|
| `en.vtt` | a `.vtt` or `.srt` file you added (`.srt` is converted) |
| `de.embedded.vtt` | a text subtitle track inside the video file (MKV, MP4), copied out with FFmpeg when you upload it |
| `fr.auto.vtt` | **automatic subtitles**: made from the speech by whisper.cpp |
| `en.translated.auto.vtt` | automatic subtitles translated into English |

The player lists them in its CC menu, and the **CC** button on the watch page
picks the language, adds files, deletes tracks and makes automatic subtitles.
**Transcript** shows the text with clickable times.

Automatic subtitles are made on your computer, never online. Offox runs
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT licence) as a
separate program, like FFmpeg. The installers include it in the `whisper`
folder next to Offox, with the multilingual `base` model. It recognises
about 100 languages and detects the language by itself. Put a bigger
`ggml-*.bin` model into `whisper/models` for more accurate subtitles:
`small`, `medium` or `large-v3-turbo`. Offox uses the most accurate model it
finds, or the one chosen in `about:offox → Automatic subtitles`. Offox reads
the sound with FFmpeg. Without FFmpeg, the page decodes the sound itself
(for formats Offox can play). New uploads get automatic subtitles unless they
bring their own; turn this off on the upload page.

Comments are stored in `videos/<id>/comments.json`. You can post, reply,
like, heart, pin, edit and delete them, and sort by top or newest. A time
such as `1:23` in a comment jumps to that point in the video.

**Videos downloaded from YouTube with yt-dlp:** upload the video together with
the files yt-dlp saved next to it, for example:

```
yt-dlp --write-subs --write-auto-subs --sub-langs "en.*,de" --convert-subs vtt \
       --write-comments --write-info-json --write-thumbnail <url>
```

OffTube adds `<video>.<lang>.vtt`/`.srt` as subtitles. Ones that YouTube
generated are marked as automatic. From `<video>.info.json`, OffTube takes
the title, description, upload date, channel and comments, with their
replies. It also uses the thumbnail.

Existing OffTube sites get these pages automatically when Offox starts.
Any page you changed by hand is first copied to `.offox-backup/<date>/` in
the site folder.
