export type SocialProjectExpressionVariable = "timeMs" | "red" | "green" | "blue";

export type SocialProjectNumericExpression =
  | { operator: "constant"; value: number }
  | { operator: "variable"; name: SocialProjectExpressionVariable }
  | {
      operator: "add" | "subtract" | "multiply" | "divide" | "lessThan" | "minimum" | "maximum";
      left: SocialProjectNumericExpression;
      right: SocialProjectNumericExpression;
    }
  | {
      operator: "if";
      condition: SocialProjectNumericExpression;
      whenTrue: SocialProjectNumericExpression;
      whenFalse: SocialProjectNumericExpression;
    };

export interface SocialProjectExpressionValues {
  timeMs: number;
  red?: number;
  green?: number;
  blue?: number;
}

export type SocialProjectFfmpegVariables = Partial<Record<SocialProjectExpressionVariable, string>>;

export function constant(value: number): SocialProjectNumericExpression {
  return { operator: "constant", value };
}

export function variable(name: SocialProjectExpressionVariable): SocialProjectNumericExpression {
  return { operator: "variable", name };
}

export function add(
  left: SocialProjectNumericExpression,
  right: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return { operator: "add", left, right };
}

export function subtract(
  left: SocialProjectNumericExpression,
  right: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return { operator: "subtract", left, right };
}

export function multiply(
  left: SocialProjectNumericExpression,
  right: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return { operator: "multiply", left, right };
}

export function divide(
  left: SocialProjectNumericExpression,
  right: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return { operator: "divide", left, right };
}

export function lessThan(
  left: SocialProjectNumericExpression,
  right: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return { operator: "lessThan", left, right };
}

export function minimum(
  left: SocialProjectNumericExpression,
  right: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return { operator: "minimum", left, right };
}

export function maximum(
  left: SocialProjectNumericExpression,
  right: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return { operator: "maximum", left, right };
}

export function conditional(
  condition: SocialProjectNumericExpression,
  whenTrue: SocialProjectNumericExpression,
  whenFalse: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return { operator: "if", condition, whenTrue, whenFalse };
}

export function evaluateSocialProjectExpression(
  expression: SocialProjectNumericExpression,
  values: SocialProjectExpressionValues,
): number {
  if (expression.operator === "constant") return expression.value;
  if (expression.operator === "variable") {
    return expression.name === "timeMs" ? values.timeMs : (values[expression.name] ?? 0);
  }
  if (expression.operator === "if") {
    return evaluateSocialProjectExpression(expression.condition, values) !== 0
      ? evaluateSocialProjectExpression(expression.whenTrue, values)
      : evaluateSocialProjectExpression(expression.whenFalse, values);
  }
  const left = evaluateSocialProjectExpression(expression.left, values);
  const right = evaluateSocialProjectExpression(expression.right, values);
  switch (expression.operator) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      return right === 0 ? left : left / right;
    case "lessThan":
      return left < right ? 1 : 0;
    case "minimum":
      return Math.min(left, right);
    case "maximum":
      return Math.max(left, right);
    default:
      throw new Error("Unsupported scene expression operator.");
  }
}

export function compileSocialProjectFfmpegExpression(
  expression: SocialProjectNumericExpression,
  variables: SocialProjectFfmpegVariables = {},
): string {
  if (expression.operator === "constant") return formatFfmpegNumber(expression.value);
  if (expression.operator === "variable") {
    return (
      variables[expression.name] ?? (expression.name === "timeMs" ? "(T*1000)" : expression.name)
    );
  }
  if (expression.operator === "if") {
    return `if(${compileSocialProjectFfmpegExpression(expression.condition, variables)},${compileSocialProjectFfmpegExpression(expression.whenTrue, variables)},${compileSocialProjectFfmpegExpression(expression.whenFalse, variables)})`;
  }
  const left = compileSocialProjectFfmpegExpression(expression.left, variables);
  const right = compileSocialProjectFfmpegExpression(expression.right, variables);
  switch (expression.operator) {
    case "add":
      return `((${left})+(${right}))`;
    case "subtract":
      return `((${left})-(${right}))`;
    case "multiply":
      return `((${left})*(${right}))`;
    case "divide":
      return `((${left})/(${right}))`;
    case "lessThan":
      return `lt(${left},${right})`;
    case "minimum":
      return `min(${left},${right})`;
    case "maximum":
      return `max(${left},${right})`;
    default:
      throw new Error("Unsupported FFmpeg scene expression operator.");
  }
}

function formatFfmpegNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Social project scene values must be finite.");
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
}
