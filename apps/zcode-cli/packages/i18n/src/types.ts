import type { SupportedLocale } from "@social-harness/contracts";

export type { SupportedLocale, UiLocale } from "@social-harness/contracts";

export interface ZCodeCopy {
  cli: CliCopy;
  commandCenter: CommandCenterCopy;
  locale: SupportedLocale;
}

export interface CliCopy {
  errors: {
    localeUnsupported(value: string): string;
  };
  help(version: string): string;
}

export interface CommandCenterCopy {
  effort: {
    disabled: string;
    enabled: string;
  };
  loginRequired: {
    help: string;
    message: string;
    status: string;
    title: string;
  };
  loginSetup: {
    emptyMessage: string;
    help: string;
    options: {
      bigmodelApiKey: {
        inputPrimary: string;
        inputSecondary: string;
        primary: string;
        secondary: string;
      };
      bigmodelOauth: {
        pendingPrimary: string;
        pendingSecondary: string;
        primary: string;
        secondary: string;
      };
      zaiApiKey: {
        inputPrimary: string;
        inputSecondary: string;
        primary: string;
        secondary: string;
      };
      zaiOauth: {
        pendingPrimary: string;
        pendingSecondary: string;
        primary: string;
        secondary: string;
      };
    };
    pending: {
      cancelStatus: string;
      help: string;
      status: string;
    };
    input: {
      cancelStatus: string;
      clearStatus: string;
      emptyStatus: string;
      help: string;
      placeholder: string;
      status: string;
      submitStatus: string;
    };
    prompt: string;
    response: string;
    title: string;
  };
}
