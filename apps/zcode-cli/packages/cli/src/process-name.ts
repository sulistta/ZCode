export const CLI_COMMAND_NAME = "social-harness";
export const CLI_PROCESS_NAME = "social-harness-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
