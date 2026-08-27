# The two files that live outside this repo

The scanner tool is three pieces. Only one of them is a normal repo file:

| Piece | Lives at | What it does |
|---|---|---|
| `scripts/scan-to-file.ts` | in the repo | the menus, the upload, the filing |
| `scan` | `~/bin/scan` | talks to the Canon over eSCL and writes a PDF |
| `Fetti Scanner.command` | `~/Desktop/Fetti Scanner/` | what Ramon double-clicks |

The bottom two are on the Mac, not in git, so copies live here. They are copies, not symlinks —
editing the ones in this folder changes nothing until you install them:

```
cp scripts/mac/scan ~/bin/scan && chmod +x ~/bin/scan
mkdir -p ~/Desktop/"Fetti Scanner"
cp "scripts/mac/Fetti Scanner.command" ~/Desktop/"Fetti Scanner"/ && chmod +x ~/Desktop/"Fetti Scanner"/"Fetti Scanner.command"
```

`scan` finds the scanner in this order: `--host`, then `Canona9e13b.lan`, then `~/.canon-scan-host`,
then a sweep of the subnet. It needs no driver and no toner — eSCL is plain HTTP and is completely
independent of the print engine, which is why an empty cartridge does not stop a scan.
