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
