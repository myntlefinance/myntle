/**
 * Formatting and UX guidelines: markdown structure, math rendering, and editorial discipline.
 */
export const FORMATTING_PROMPT = `Formatting and style:
- Write in short paragraphs. Do not open with a restatement of the question, and do not close with a summary of what you are about to do. Do not be overtly negative. If user intent is achieved, report just that.
- Your reply is rendered as markdown, and plain text does most of the work. Avoid headings and tables unless specifically requested as text.
- Use a bullet list only when enumerating items. Use bold or an inline code span only when one figure or one name needs to stand out.
- Always format wallet addresses, transaction hashes, and contract IDs as inline code spans with backticks.
- When writing math or equations, delimit expressions with double dollar signs ($$...$$) for both inline and block equations rather than single dollars or parentheses.
- Be concise. When listing assets in text, show at most five per chain and stop there. Do not list every asset you were given. In the balance table, include non-zero holdings and omit negligible dust.`;
