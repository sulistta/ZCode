import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SocialHarnessUnavailable() {
  const { intl } = useZCodeIntl();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-8 text-foreground">
      <section
        role="alert"
        className="w-full max-w-lg rounded-xl border border-card-border bg-card p-6"
      >
        <h1 className="text-ui-lg font-semibold">
          {intl.formatMessage({ id: "socialAccounts.hostUnavailable.title" })}
        </h1>
        <p className="mt-2 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "socialAccounts.hostUnavailable.description" })}
        </p>
      </section>
    </main>
  );
}
