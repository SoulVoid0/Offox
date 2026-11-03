/* Declarations that ggml uses but the MinGW-w64 headers of Ubuntu 24.04 lack
 * (from the Windows SDK's processthreadsapi.h). Force-included into the C
 * files of the Windows build by build-whisper.sh. */
#ifndef OFFOX_MINGW_COMPAT_H
#define OFFOX_MINGW_COMPAT_H
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#ifndef THREAD_POWER_THROTTLING_CURRENT_VERSION
#define THREAD_POWER_THROTTLING_CURRENT_VERSION 1
#define THREAD_POWER_THROTTLING_EXECUTION_SPEED 0x1
#define THREAD_POWER_THROTTLING_VALID_FLAGS THREAD_POWER_THROTTLING_EXECUTION_SPEED
typedef struct _THREAD_POWER_THROTTLING_STATE {
  ULONG Version;
  ULONG ControlMask;
  ULONG StateMask;
} THREAD_POWER_THROTTLING_STATE;
#endif
#endif
