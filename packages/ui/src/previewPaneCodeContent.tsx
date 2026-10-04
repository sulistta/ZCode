import type { BundledLanguage, BundledTheme } from "shiki";
import type { Ref, UIEventHandler } from "react";
import { cn } from "@/components/lib/utils.js";
import { MermaidBlock } from "@/components/ai-elements/mermaid-block.js";
import { CodeViewer } from "@/components/ui/code-viewer.js";
import type { CodePreviewSettings } from "@/store/index.js";
import { isMermaidLanguage } from "@/lib/mermaidLanguage.js";
import type { Theme } from "@/useTheme.js";

interface CodeContentProps {
  code: string;
  language: BundledLanguage;
  codePreviewSettings: CodePreviewSettings;
  codeTheme: BundledTheme;
  /** 应用主题（store 耦合剥离）：透传给 Mermaid 预览，缺省按 "system" 兜底。 */
  theme?: Theme;
  wrapLongLines: boolean;
  firstLineNumber?: number;
  onScroll?: UIEventHandler<HTMLDivElement>;
  scrollContainerRef?: Ref<HTMLDivElement>;
  className?: string;
}

export function CodeContent({
  code,
  language,
  codePreviewSettings,
  codeTheme,
  theme,
  wrapLongLines,
  firstLineNumber,
  onScroll,
  scrollContainerRef,
  className,
}: CodeContentProps) {
  if (isMermaidLanguage(language)) {
    return (
      <div
        ref={scrollContainerRef}
        className={cn("h-full w-full overflow-auto bg-background p-4", className)}
        onScroll={onScroll}
      >
        <MermaidBlock
          code={code}
          theme={theme}
          className="min-h-full rounded-xl border border-border"
        />
      </div>
    );
  }

  return (
    <CodeViewer
      code={code}
      language={language}
      showLineNumbers={codePreviewSettings.showLineNumbers}
      theme={codeTheme}
      wrapLongLines={wrapLongLines}
      fontSizePx={codePreviewSettings.fontSizePx}
      firstLineNumber={firstLineNumber}
      onScroll={onScroll}
      scrollContainerRef={scrollContainerRef}
      className={className}
    />
  );
}
