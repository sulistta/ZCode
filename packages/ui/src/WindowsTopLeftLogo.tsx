import { cn } from "@/components/lib/utils.js";

export function WindowsTopLeftLogo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        // 顶部栏展示产品名；模型提供商图标不代表应用品牌，避免旧供应商标识被误认作 Social Harness 标志。
        "absolute left-1 top-1 mt-px ml-px z-20 flex h-12 items-center px-3 [app-region:drag]",
        className,
      )}
    >
      <span className="pointer-events-none select-none whitespace-nowrap text-ui-base font-semibold text-foreground">
        Social Harness
      </span>
    </div>
  );
}
