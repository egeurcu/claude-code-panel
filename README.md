# panel

A right-docked live panel for [Claude Code](https://claude.com/claude-code), built as a mod (function-hook plugin). It has four tabs:

| Tab | What it shows |
|-----|---------------|
| **Panel** | Animated Ditto mascot that changes shape with the running tool (terminal, pencil, magnifier, globe). Context / 5-hour / 7-day usage meters with reset times and cost. Subagents, foreground and background shells, a turn timeline, recent tool calls, tool stats, edited files, and graphify status. |
| **Code** | Git branch, ahead/behind, changed files with inline diffs, and recent commits. `package.json` scripts, collapsed by default, with run and a two-step stop. A TODO hunter that ranks TODO/FIXME lines with Haiku 5.5 through your own Claude Code login. |
| **System** | Listening ports grouped as dev servers and databases, with a two-step kill. Docker containers with start, stop and logs. Language switch (Türkçe / English). |
| **Sessions** | Every resumable session from every project, grouped by project. Click one to resume it in a new Windows Terminal tab. Delete a session with `×`, or remove all untitled sessions (slash commands only) at once. Deleted sessions go to the Recycle Bin. |

Toggle all tabs with `/panel`.

## Requirements

- Windows 10/11 with PowerShell 7 (`pwsh`) and Windows Terminal (`wt.exe`)
- Claude Code with the fullscreen TUI
- git
- Docker Desktop (optional)

## Install

Type this at the Claude Code prompt in a terminal session:

```
/plugin install panel --marketplace egeurcu/claude-code-panel
```

Answer `y` to add the marketplace, then pick the user scope. The panel opens on the right when the terminal is wide enough. `/panel` hides and shows it.

The right-docked layout needs the fullscreen TUI, so set `"tui": "fullscreen"` in `~/.claude/settings.json` (or run `/tui fullscreen`).

## Develop

Clone the repository, then load it from the folder instead of installing it:

```powershell
git clone https://github.com/egeurcu/claude-code-panel.git $HOME\.claude\mods\panel
claude --plugin-dir $HOME\.claude\mods\panel
```

To load it in every session, set `env.CLAUDE_CODE_PLUGIN_DIRS` to that folder in `~/.claude/settings.json`. Don't combine this with the installed plugin, or it loads twice.

```powershell
claude plugin test .
claude plugin validate .
```

Claude Code writes `.claude-plugin/types/` the first time it loads the mod. After that, `tsc -p .` type-checks the code.

## Note

Ditto is a Pokémon character owned by Nintendo / Game Freak. The sprite here is fan art for personal use, so replace it before making this repository public.

## License

MIT, see [LICENSE](LICENSE). The license covers the code only; the Ditto sprite is excluded.

---

## Türkçe

Claude Code için sağa yerleşen canlı bir panel. **Panel**, **Code**, **System** ve **Sessions** sekmelerinden oluşur ve `/panel` ile açılıp kapanır. Arayüz dili System sekmesinin en altından değiştirilir.

Kurulum: Claude Code'da `/plugin install panel --marketplace egeurcu/claude-code-panel` yaz, `y` ile marketplace'i ekle, user kapsamını seç. Sessions sekmesinde `×` ile ya da `🧹 Başlıksızları sil` ile silinen oturumlar Geri Dönüşüm Kutusu'na taşınır ve oradan geri alınabilir.
