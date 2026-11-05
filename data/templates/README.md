# Templates

This directory is intentionally empty in the repository.

`KDE_DeckList.pdf` is Konami's official tournament deck-registration form. It is
**not redistributed** with this project. The PDF tool downloads it on first use
into this directory:

```bash
ygo fetch-data
```

If the download is unavailable, point the tool at your own copy:

```bash
# PowerShell
$env:YGO_KDE_TEMPLATE = "C:\path\to\KDE_DeckList.pdf"
```

The form is only used to fill a blank sheet for personal deck registration; it
is not covered by this project's AGPL licence.
