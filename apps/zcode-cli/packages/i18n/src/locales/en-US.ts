import type { ZCodeCopy } from "../types.js";

export const enUS: ZCodeCopy = {
  locale: "en-US",
  cli: {
    errors: {
      localeUnsupported: (value) =>
        `Unsupported --locale value: ${value}. Supported locales: en-US, zh-CN, auto.`,
    },
    help: (version) => `social-harness ${version}

Usage:
  social-harness [command] [options]

With no command, print this help. The CLI is an internal headless Agent runtime.

Commands:
  app-server Run the Social Harness Agent stdio server
  commands   List custom slash commands (\`commands list\`)
  doctor     Inspect runtime and packaging assumptions
  login [zai|bigmodel]  Sign in through browser authorization
  logout     Remove the shared Z.AI login credentials
  plugins    Manage plugins and marketplaces (\`plugins list|install|uninstall|enable|disable|update|validate|marketplace ...\`; alias: plugin)
  skills     List local skills (\`skills list\`)
  version    Print the CLI version

Options:
  -h, --help       Show help
  -v, --version    Show version
  -p, --prompt <text>  Run a single headless prompt
  --memory-bench   With --prompt, enable automatic Memory extraction and wait before exiting (requires Memory enabled)
  --browser-use <mode> Enable Browser Use backend (supported: headless)
  --surface <surface>  Presentation surface for headless prompts/app-server: terminal or desktop
  --browser-executable <path> Chrome/Chromium executable for headless Browser Use
  --attach <path>  Attach a local file to --prompt; repeat for multiple files
  --cwd <path>     Run this command from the given directory
  --disallowed-tools, --disallowedTools <tools...>
    Remove whole tools for this prompt only; saved settings are unchanged.
    Comma or space-separated tool names, e.g. "Bash Edit".
    "Bash(git *)" removes all of Bash; command patterns are not matched.
  --force-mcs      Force mid-conversation system projection for Anthropic providers
  --locale <locale>  UI locale: en-US, zh-CN, or auto
  --mode <mode>    Permission mode for prompts: build, edit, plan, or yolo (default: yolo for --prompt)
  --resume <sessionId>  Resume a persisted session by sessionId (sess_...)
  --target <text>  Run or set the session goal in headless mode
  --target-replace Replace any existing session goal set by --target
  -c, --continue        Resume the latest session for the current directory
  --json           Print machine-readable JSON where supported
  --no-browser     Print the OAuth URL without opening a browser
  --no-color       Disable ANSI colors
  --verbose        Print extra diagnostic detail

Slash Commands:
  /help [command]       Show slash command help
  /login                Choose Z.AI or BigModel browser login
  /logout               Remove the shared Z.AI login credentials
  /compact [instructions]  Compact the current conversation
  /expert [status|resume|stop|<task>]  Run or manage the expert workflow
  /dwf [list|cancel|resume]  List, cancel, or resume dynamic workflow runs
  /fork [latest|checkpointId]  Fork a new session from a workspace checkpoint
  /mcp [list|status|connect|disconnect]  Show or manage MCP servers
  /mode [mode]          Show or switch permission mode: build, edit, plan, or yolo
  /model [id]           Show or switch the current session model
  /new                  Start a fresh session
  /resume [sessionId]   Resume a session by sessionId; omit it for latest in cwd
  /rewind [latest|checkpointId]  Show latest checkpoint or restore workspace files
  /skill [name] [task]  List skills, or force the next prompt to load one
  /goal [action]        Show or set the current session goal
`,
  },
  commandCenter: {
    effort: {
      disabled: "disabled",
      enabled: "enabled",
    },

    loginRequired: {
      help: "Use /model to view models, or /login to connect a Coding Plan account.",
      message: "No available models. Configure a provider or sign in with /login.",
      status: "No available models. Configure a provider or sign in with /login.",
      title: "model setup required",
    },

    loginSetup: {
      emptyMessage: "No login options are available.",
      help: "Use Up/Down to choose, Enter to select.",
      options: {
        bigmodelApiKey: {
          inputPrimary: "Enter BigModel Coding Plan API Key",
          inputSecondary: "Paste the key here. It is hidden while typing.",
          primary: "BigModel Coding Plan API Key",
          secondary: "Paste a Coding Plan API key manually.",
        },
        bigmodelOauth: {
          pendingPrimary: "Waiting for BigModel authorization",
          pendingSecondary:
            "Complete sign-in in your browser. Authorization is detected automatically.",
          primary: "BigModel Coding Plan",
          secondary: "Open browser login; authorization is detected automatically.",
        },
        zaiApiKey: {
          inputPrimary: "Enter Z.AI Coding Plan API Key",
          inputSecondary: "Paste the key here. It is hidden while typing.",
          primary: "Z.AI Coding Plan API Key",
          secondary: "Paste a Coding Plan API key manually.",
        },
        zaiOauth: {
          pendingPrimary: "Waiting for Z.AI authorization",
          pendingSecondary:
            "Complete sign-in in your browser. I will continue when authorization finishes.",
          primary: "Z.AI Coding Plan",
          secondary: "Open browser login and create a Coding Plan API key.",
        },
      },
      pending: {
        cancelStatus: "Login cancelled. Choose a setup method.",
        help: "Esc cancels and returns to setup choices.",
        status: "Waiting for browser authorization...",
      },
      input: {
        cancelStatus: "API key entry cancelled. Choose a setup method.",
        clearStatus: "API key input cleared.",
        emptyStatus: "API key is required.",
        help: "Enter saves the key. Esc returns to setup choices.",
        placeholder: "Paste API key",
        status: "Enter the API key, then press Enter.",
        submitStatus: "Saving API key...",
      },
      prompt: "Choose a login or API key setup method.",
      response: "Choose how to set up a Coding Plan provider.",
      title: "Set Up Coding Plan",
    },
  },
};
