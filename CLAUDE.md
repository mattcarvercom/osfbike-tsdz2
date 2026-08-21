# TSDZ2-Smart-EBike-1 - guidance for Claude Code

## Git workflow - public repo, `master` is protected

This is a public GitHub repo (`mattcarvercom/osfbike-tsdz2`, forked from
`emmebrusa/TSDZ2-Smart-EBike-1`). `master` has GitHub branch protection turned on
(required PR, `enforce_admins: true`, no force-pushes/deletions) specifically so nobody -
human or Claude - can push to it directly, even by accident.

- **Never push directly to `master`.** All work happens on a feature branch (currently
  `rewrite`) and lands via PR.
- **Always check with the user before pushing anything to the public remote**, even to a
  non-`master` branch. This is a standing instruction, not a one-off.
- The active workflow on `rewrite`: keep amending/adding commits locally as changes are
  made, then when the user says it's ready, squash to one commit
  (`git reset --soft master && git commit`) and update the existing PR with
  `git push --force-with-lease origin rewrite` (lease, not a bare `--force`, so a push
  refuses instead of clobbering if something unexpected landed on the remote branch since
  the last push).
- Do not merge the PR unprompted - that's the user's call.

Two mostly-separate tool areas exist to orient a fresh session:

| Path | What |
|---|---|
| `tools/` | Browser-based build+flash tool for the firmware. See `tools/CLAUDE.md`. |
| `tests/` (this file) | Native host-compiled C test harness for `firmwares/motor/tsdz2/src/*.c` firmware logic - see below. |

## `tests/` - native pytest/cffi harness for `firmwares/motor/tsdz2/src/` firmware logic

Inherited from upstream (`pyproject.toml`'s Homepage), not something built for this
fork - but it needed real fixes to actually run (see "Known-broken things fixed" below),
and this session extended it for the first time to cover real feature logic rather than
pure-math helpers. If picking this up again, read this whole section first; it exists so
that work isn't redone.

### What it is

`tests/load_c_code.py` compiles **all of `firmwares/motor/tsdz2/src/*.c` unmodified** as one combined
translation unit (via `cffi` + `pycparser`) into a real native shared library, and
exposes it to pytest as `sim._tsdz2` (`from sim._tsdz2 import ffi, lib as ebike`).

The `static`-function problem looks worse than it is: `uart_receive_package()`,
`apply_cruise()`, `ebike_control_motor()` are all `static` in `ebike_app.c`, but cffi's
generated glue code takes `&function_name` directly from *within* the same translation
unit (cffi pastes your source and its own glue into one `.c` file), so C's
static/internal-linkage restriction - which only blocks *cross-TU* symbol resolution -
never applies. `tests/test_diag.py` already proved this by calling
`ebike.uart_receive_package()` directly.

This means real firmware **behavior** (not just "does it compile") is genuinely
testable: synthesize a UART display packet into `ebike.ui8_rx_buffer[]`, set
`ebike.ui8_received_package_flag = 1`, call `ebike.uart_receive_package()`, then inspect
whatever static state you care about. No CPU or peripheral emulation needed for this
class of bug - see `tests/test_cruise_override.py` for a real example.

```sh
uv sync              # or: pip install .
uv run pytest tests/ -q
uv run pytest tests/test_cruise_override.py -v
```

### Known-broken things fixed to get this running again (2026-08-13)

1. **`pycparser` 3.0 breaks it.** `load_c_code.py` imports `pycparser.plyparser`, which
   pycparser 3.0 removed/renamed. `pyproject.toml` never pinned pycparser (only pulled
   it in transitively via `cffi`), so a fresh install silently resolved to 3.0 and
   `tests/conftest.py` failed to import with no obvious cause. **Fixed**: pinned
   `pycparser <3.0` in `pyproject.toml` (resolves to 2.23). If tests fail to import with
   `cannot import name 'plyparser'`, this is why - check the pin is still there.
2. **The checked-in `firmwares/motor/tsdz2/src/config.h` must define every macro `main.h`/`ebike_app.c` use.**
   It's a real, git-tracked reference config kept in sync with the fork's actual
   defaults (not vestigial, not dead weight) - but nothing regenerates it automatically
   when a new feature adds config.h macros, and a config.h missing one is a hard native
   compile error (`error: 'FOO' undeclared`), not a silent default, if that macro is
   ever used outside an `#if`. If you add a new fork feature with new config.h macros,
   **add them to `firmwares/motor/tsdz2/src/config.h` too** (matching whatever `config-h-generator.ts` emits
   for "disabled/default"), or both this test harness and a plain native `make` build
   break for anyone whose config.h predates the feature.
3. **`uart_receive_package()` really does touch real hardware.** Near its end it
   re-enables the UART2 RX interrupt with a genuine register write,
   `UART2->CR2 |= (1 << 5)`. `UART2` is a `stm8s_uart2.h` macro for a fixed low STM8
   memory address - dereferencing it under a native x86 build segfaults immediately.
   (Diagnosed via `gdb -batch -ex run -ex bt --args <python> script.py` - Python's own
   traceback only shows Python frames, not the C frame that actually crashed.)
   `tests/test_diag.py`'s existing test never hits this because it never sets
   `ui8_received_package_flag`, so it skips the whole guarded block this line lives in -
   but anything exercising the button/checksum path will. Not a bug to fix in
   `ebike_app.c` (it's correct real firmware behavior) and not worth stubbing all of
   `stm8s_uart2.h` project-wide. `tests/test_cruise_override.py`'s fixture works around
   it locally: appends `#undef UART2` / `#define UART2 (&some_static_struct)` to its own
   **scratch copy** of `config.h`, redirecting the macro at ordinary process memory.
   Safe because these tests bypass UART2 entirely anyway (writing straight to
   `ui8_rx_buffer` rather than simulating received bytes). Reuse this pattern for any
   new test that calls `uart_receive_package()` with `ui8_received_package_flag = 1`.

### Testing a feature that needs a non-default `config.h`

Every test file shares one compiled module (`sim._tsdz2`, built once per pytest session
against the real, unmodified `firmwares/motor/tsdz2/src/config.h`) unless it opts out. If your feature is off
by default in `firmwares/motor/tsdz2/src/config.h` (most fork features are), you can't just flip flags at
runtime - config.h macros are compiled in via `#if`/`#define`, not runtime-toggleable.

`tests/test_cruise_override.py`'s `ebike` fixture is the reusable pattern: copies
`firmwares/motor/tsdz2/src/*.c`/`*.h` (top-level only, not `STM8S_StdPeriph_Lib/`) into a `tempfile` scratch
dir, regex-patches specific `#define KEY value` lines in the copied `config.h`, then
temporarily reassigns `load_c_code`'s module-level `source_dirs`/`include_dirs` globals
to point at the scratch copy for one `load_code("_tsdz2_<yourfeature>",
force_recompile=True)` call before restoring them - so the default `sim._tsdz2` module
every other test file uses stays built against the real `firmwares/motor/tsdz2/src/`, untouched. Give your
module a distinct name; `tests/sim/*` is gitignored (except the checked-in
`_tsdz2.cdef` fixture) so nothing here needs cleanup.

### Pre-existing test rot (fixed 2026-08-14)

`tests/test_wheel_speed.py`, `tests/test_diag.py`, and `tests/test_speed_limit.py` were
21 failed / 13 errored on master (unrelated to this session's cruise-override work) - two
separate root causes, both now fixed, full suite passed clean at 147 tests as of this fix
(count grows over time as features gain coverage - see `test_cruise_override.py`'s own
history for an example - so don't treat 147 as a number to re-verify, just "all green"):

1. **Stale variable names.** `test_diag.py` set `ui16_battery_voltage_filtered_x1000`,
   which doesn't exist anywhere in `firmwares/motor/tsdz2/src/` (real name/scale: `ui16_battery_voltage_filtered_x10`,
   e.g. 48V is `480` not `48000`) - it silently set a stray Python attribute on the cffi
   `lib` object rather than erroring, so the intended assignment was just a no-op.
   `test_speed_limit.py` read/wrote `m_configuration_variables.ui8_wheel_speed_max`, but
   that field is `ebike_app.c`'s file-scope `ui8_wheel_speed_max`, never part of
   `m_configuration_variables` - this one *did* raise `AttributeError` (cffi does enforce
   struct member names). Both fixed by using the real name.
2. **Stale wheel-speed constants.** `test_wheel_speed.py`'s hardcoded expected values and
   its `MOTOR_TASK_FREQ` reference constant were computed for `PWM_FREQ=19`
   (`PWM_COUNTER_MAX=420`), but the checked-in `firmwares/motor/tsdz2/src/config.h` default is `PWM_FREQ=18`
   (`PWM_COUNTER_MAX=444`, see `firmwares/motor/tsdz2/src/main.h`) - a real firmware-default change the tests
   were never updated for, not a naming issue. Recomputed against
   `calc_wheel_speed()`'s actual formula (`ui16_wheel_speed_x10 = (perimeter_mm *
   ((PWM_CYCLES_SECOND/1000)*36)) / ticks`, all integer-truncating, narrowing to
   `uint16_t` at the end) - see the comments in that file for the full derivation. If
   `config.h`'s `PWM_FREQ` default ever changes again, these need recomputing too.

## Full history / design rationale

`UNIVERSAL_FIRMWARE_PLAN.md`'s "Phase 2: Tuning firmware" section has the full story
behind every fork-only feature, including the cruise-control-override bugs this test
harness was built to catch and the STM8-Emulator investigation that was rejected in
favor of it.
