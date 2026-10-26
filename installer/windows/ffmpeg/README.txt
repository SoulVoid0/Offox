Optional: put an LGPL build of FFmpeg here (ffmpeg.exe and its DLLs) before
building the installer, and Offox will be able to convert AVI, WMV, FLV and
other old video formats out of the box. Builds: https://www.gyan.dev/ffmpeg/builds/
("essentials", which is GPL) or https://github.com/BtbN/FFmpeg-Builds/releases
(choose a file with "lgpl" in its name to keep Offox free of GPL code).
Without it, Offox still uses an ffmpeg found on the PATH or chosen in about:offox.
