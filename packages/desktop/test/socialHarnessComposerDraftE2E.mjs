/** 驱动真实 Lexical state；失败时只记录隔离 fixture 的状态形状。 */
export async function fillSocialAgentDraft(page, prompt) {
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="v4-composer-input"]');
    return (
      input?.getAttribute("data-e2e-lexical-bridge") === "ready" &&
      typeof input.__zcodeLexicalInputE2E?.setText === "function"
    );
  });
  const submittedEditor = await page.evaluateHandle((text) => {
    const input = document.querySelector('[data-testid="v4-composer-input"]');
    const bridge = input.__zcodeLexicalInputE2E;
    bridge.setText(text);
    return { input, bridge };
  }, prompt);
  try {
    await page.waitForFunction((expectedText) => {
      const input = document.querySelector('[data-testid="v4-composer-input"]');
      return input?.__zcodeLexicalInputE2E?.getText() === expectedText;
    }, prompt);
  } catch (error) {
    const state = await page.evaluate(
      ({ submitted, expected }) => {
        const inputs = document.querySelectorAll('[data-testid="v4-composer-input"]');
        const input = inputs[0];
        const text = input?.__zcodeLexicalInputE2E?.getText();
        return {
          inputCount: inputs.length,
          sameInput: input === submitted.input,
          submittedInputConnected: submitted.input.isConnected,
          sameBridge: input?.__zcodeLexicalInputE2E === submitted.bridge,
          lexicalCharacters: text?.length,
          lexicalMatches: text === expected,
          domCharacters: input?.textContent?.length,
          domMatches: input?.textContent === expected,
          editable: input?.getAttribute("contenteditable"),
          submittedLexicalCharacters: submitted.bridge.getText().length,
          submittedLexicalMatches: submitted.bridge.getText() === expected,
        };
      },
      { submitted: submittedEditor, expected: prompt },
    );
    throw new Error(`Fixture draft state: ${JSON.stringify(state)}`, {
      cause: error,
    });
  } finally {
    await submittedEditor.dispose();
  }
}
