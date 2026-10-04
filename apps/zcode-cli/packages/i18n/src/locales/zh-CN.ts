import type { ZCodeCopy } from "../types.js";

export const zhCN: ZCodeCopy = {
  locale: "zh-CN",
  cli: {
    errors: {
      localeUnsupported: (value) =>
        `不支持的 --locale 值：${value}。支持的语言：en-US、zh-CN、auto。`,
    },
    help: (version) => `social-harness ${version}

用法:
  social-harness [command] [options]

不传 command 时显示此帮助。CLI 仅供内部 headless Agent runtime 使用。

命令:
  app-server 运行 Social Harness Agent stdio 服务
  commands   列出自定义 slash commands（\`commands list\`）
  doctor     检查运行时和打包假设
  login [zai|bigmodel]  通过浏览器授权登录
  logout     删除共享的 Z.AI 登录凭据
  plugins    管理插件与市场（\`plugins list|install|uninstall|enable|disable|update|validate|marketplace ...\`；别名 plugin）
  skills     列出本地 skills（\`skills list\`）
  version    打印 CLI 版本

选项:
  -h, --help       显示帮助
  -v, --version    显示版本
  -p, --prompt <text>  以 headless 模式运行一次 prompt
  --memory-bench   配合 --prompt 开启自动 Memory 提取并等待后退出（需已开启 Memory）
  --browser-use <mode> 启用 Browser Use backend（当前支持：headless）
  --surface <surface>  设置无头 prompt/app-server 的呈现面：terminal 或 desktop
  --browser-executable <path> headless Browser Use 使用的 Chrome/Chromium 路径
  --attach <path>  给 --prompt 附加本地文件；可重复传入
  --cwd <path>     从指定目录运行命令
  --disallowed-tools, --disallowedTools <tools...>
    从本次 prompt 的可用工具集中移除整个工具，不修改持久化配置。
    工具名用逗号或空格分隔，例如 "Bash Edit"。
    "Bash(git *)" 也会移除整个 Bash，不支持按命令内容匹配。
  --force-mcs      对 Anthropic provider 强制启用 mid-conversation system 投影
  --locale <locale>  UI 语言：en-US、zh-CN 或 auto
  --mode <mode>    prompt 权限模式：build、edit、plan 或 yolo（--prompt 默认 yolo）
  --resume <sessionId>  按 sessionId 恢复持久化 session（sess_...）
  --target <text>  在 headless 模式运行或设置 session goal
  --target-replace 替换 --target 已存在的 goal
  -c, --continue        恢复当前目录最近的 session
  --json           在支持的命令中输出机器可读 JSON
  --no-browser     不打开浏览器，只打印 OAuth URL
  --no-color       禁用 ANSI 颜色
  --verbose        打印更多诊断信息

Slash Commands:
  /help [command]       显示 slash command 帮助
  /login                使用 Z.AI OAuth 登录
  /logout               删除共享的 Z.AI 登录凭据
  /compact [instructions]  压缩当前对话
  /expert [status|resume|stop|<task>]  运行或管理 expert workflow
  /dwf [list|cancel|resume]  列出、取消或恢复 dynamic workflow run
  /fork [latest|checkpointId]  从 workspace checkpoint 派生新 session
  /mcp [list|status|connect|disconnect]  查看或管理 MCP servers
  /mode [mode]          查看或切换权限模式：build、edit、plan 或 yolo
  /model [id]           查看或切换当前 session 模型
  /new                  开始新 session
  /resume [sessionId]   按 sessionId 恢复 session；省略时恢复当前 cwd 最新 session
  /rewind [latest|checkpointId]  查看最新 checkpoint 或恢复 workspace 文件
  /skill [name] [task]  列出 skills，或强制下一次 prompt 加载某个 skill
  /goal [action]        查看或设置当前 session goal
`,
  },
  commandCenter: {
    effort: {
      disabled: "关闭",
      enabled: "开启",
    },

    loginRequired: {
      help: "输入 /model 查看模型，或输入 /login 连接 Coding Plan 账号。",
      message: "没有可用模型，请配置 Provider 或输入 /login 登录。",
      status: "没有可用模型，请配置 Provider 或输入 /login 登录。",
      title: "需要配置模型",
    },

    loginSetup: {
      emptyMessage: "没有可用的登录选项。",
      help: "使用 Up/Down 选择，Enter 确认。",
      options: {
        bigmodelApiKey: {
          inputPrimary: "输入 BigModel Coding Plan API Key",
          inputSecondary: "在这里粘贴 key，输入时会隐藏显示。",
          primary: "BigModel Coding Plan API Key",
          secondary: "手动粘贴 Coding Plan API key。",
        },
        bigmodelOauth: {
          pendingPrimary: "等待 BigModel 授权",
          pendingSecondary: "请在浏览器里完成登录，授权成功后会自动继续配置。",
          primary: "BigModel Coding Plan",
          secondary: "打开浏览器登录，CLI 会自动查询授权结果。",
        },
        zaiApiKey: {
          inputPrimary: "输入 Z.AI Coding Plan API Key",
          inputSecondary: "在这里粘贴 key，输入时会隐藏显示。",
          primary: "Z.AI Coding Plan API Key",
          secondary: "手动粘贴 Coding Plan API key。",
        },
        zaiOauth: {
          pendingPrimary: "等待 Z.AI 授权",
          pendingSecondary: "请在浏览器里完成登录。授权完成后会继续配置。",
          primary: "Z.AI Coding Plan",
          secondary: "打开浏览器登录，并创建 Coding Plan API key。",
        },
      },
      pending: {
        cancelStatus: "已取消登录。请选择配置方式。",
        help: "按 Esc 取消，并返回配置方式选择。",
        status: "正在等待浏览器授权...",
      },
      input: {
        cancelStatus: "已取消 API key 输入。请选择配置方式。",
        clearStatus: "已清空 API key 输入。",
        emptyStatus: "API key 不能为空。",
        help: "按 Enter 保存 key，按 Esc 返回配置方式选择。",
        placeholder: "粘贴 API key",
        status: "输入 API key 后按 Enter。",
        submitStatus: "正在保存 API key...",
      },
      prompt: "选择登录或 API key 配置方式。",
      response: "选择 Coding Plan 提供商的配置方式。",
      title: "配置 Coding Plan",
    },
  },
};
