# Archive fixtures

Built deterministically by `tests/fixtures/scripts/generate-archive-fixtures.mjs`.

Run: `node tests/fixtures/scripts/generate-archive-fixtures.mjs`
Re-run after `_shared/tar` changes that affect byte-level format
(none expected — POSIX ustar is stable).

Note: 4 of the 11 fixtures (`encrypted.zip`, `tar-cli-sample.tar`,
`tar-bad-checksum.tar`, `tar-truncated.tar`) are NOT byte-stable on
re-run because Info-ZIP `zip -P` and BSD `tar` embed live timestamps.
The committed files are the source of truth for tests; if a re-run
dirties these, `git checkout` reverts.

## Happy-path fixtures (3)

| File | Contents |
|---|---|
| `sample.zip` | `hello.txt` ("hello\n"), `data/notes.md` ("# notes\n") |
| `sample.tar` | same |
| `sample.tar.gz` | same |

## Security fixtures (5)

| File | Built via | Purpose |
|---|---|---|
| `encrypted.zip` | shell-out to `zip -P test` | Encrypted-rejection test |
| `zip-slip.zip` | hand-written ZIP local + central headers | Zip-slip rejection test |
| `huge-entry.zip` | hand-written ZIP central directory with forged 2 GB size field | Per-entry-cap rejection |
| `bomb.zip` | hand-written: 100 entries × forged 50 MB each | Aggregate-cap rejection |
| `bare.gz` | `fflate.gzipSync` of "hello\n" | GZIP-of-non-TAR rejection |

## TAR-format fixtures (4)

| File | Built via | Purpose |
|---|---|---|
| `tar-cli-sample.tar` | shell-out to `tar -cf` (the *only* fixture not built by JS) | `_shared/tar.readTar` validated against an independent writer |
| `tar-bad-checksum.tar` | `tar-cli-sample.tar` with one byte flipped | Bad-checksum rejection |
| `tar-truncated.tar` | `tar-cli-sample.tar` cut mid-payload | Truncation rejection |
| `tar-sparse.tar` | hand-written headers with typeflag `S` | Sparse-file rejection |

## External tools required to regenerate

- `zip` (Info-ZIP) for `encrypted.zip`. Available via Homebrew or apt.
- `tar` (BSD or GNU) for `tar-cli-sample.tar`. Universally available.

The build script reports what it skipped if these tools are absent — but the
committed fixtures are the source of truth for tests, so missing tools only
matter when regenerating.
