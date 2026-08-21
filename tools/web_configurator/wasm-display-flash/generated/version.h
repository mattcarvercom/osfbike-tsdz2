/* Hand-generated stand-in for vendor/stlink/inc/version.h.in, which
 * CMake's configure_file() would normally fill in from a real git describe
 * (see vendor/stlink/CMakeLists.txt's get_version.cmake). We bypass CMake
 * entirely (see wasm-display-flash/build.sh's header comment), and nothing
 * in this app's code path reads these values - stlink-org's own st-flash
 * CLI prints STLINK_VERSION in its banner, but we never call that CLI, only
 * the library functions it wraps - so the exact value doesn't matter beyond
 * letting stlink.h's #include <version.h> resolve.
 */
#ifndef VERSION_H
#define VERSION_H

#define STLINK_VERSION "wasm-display-flash"
#define STLINK_VERSION_MAJOR 0
#define STLINK_VERSION_MINOR 0
#define STLINK_VERSION_PATCH 0

#endif // VERSION_H
