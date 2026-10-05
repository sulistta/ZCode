# Installed Preview process validation

Packaged OAuth delivery and replay rejection must be checked against real Electron processes from the generated installer. Keep the existing production Main callback owner, Host ticket consumption and Renderer readiness handshake; this changes only the isolated validation harness.

The Linux smoke previously invoked `--appimage-extract-and-run` for every process, including the replay probe. Its 15-second process-exit budget also counted repeated extraction and cleanup of the full package. Diagnostic output showed the replay probe still extracting resources when that budget expired. Do not extend the timeout or infer an application failure from extraction output. Extract the supplied AppImage once into the test-owned temporary directory with its documented `--appimage-extract` interface, then launch the packaged `AppRun` for primary, callback and replay processes. Preserve `APPIMAGE` and `APPDIR` for original artifact identity and resource resolution. Windows and macOS continue to use their installed executable inputs. No external extractor, FUSE installation or production behavior change is required.

The test runner owns the temporary installation and process cleanup. Installation uses the existing bounded launch budget; callback/secondary-process exit retains its current budget. Each actual secondary process must exit, exactly one callback must reach the ready Renderer, replay must not deliver another callback, relaunch must retain the account and the isolated legacy sentinel must remain unchanged. Include captured process output on a failure. A fixture callback does not prove real Meta authentication or publication.

```mermaid
sequenceDiagram
  participant Runner as Isolated test runner
  participant Image as Generated AppImage
  participant Primary as Packaged Main and Renderer
  participant Secondary as Packaged secondary Main
  Runner->>Image: extract once into owned temporary installation
  Runner->>Primary: launch packaged AppRun
  Runner->>Secondary: launch same installed AppRun with fixture callback
  Secondary->>Primary: single-instance callback handoff
  Secondary-->>Runner: actual process exit
  Primary-->>Runner: exactly one Renderer callback
  Runner->>Secondary: replay same fixture callback
  Secondary-->>Runner: process exit; no second delivery
  Runner->>Primary: close and relaunch; verify durable account
  Runner->>Runner: remove only owned temporary installation
```

Official references: [AppImage extraction and AppRun](https://docs.appimage.org/user-guide/troubleshooting/fuse.html), [runtime artifact identity variables](https://docs.appimage.org/packaging-guide/environment-variables.html).
