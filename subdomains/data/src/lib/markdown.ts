import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { PluggableList } from 'unified'

export const remarkPlugins: PluggableList = [remarkMath]

export const rehypePlugins: PluggableList = [
  [
    rehypeKatex,
    {
      throwOnError: false,
      errorColor: '#cc0000',
      strict: false,
    },
  ],
]

/**
 * Normalize LaTeX delimiters and escape currency patterns to prevent false math detection.
 * - Converts \(...\) to $...$ (inline math)
 * - Converts \[...\] to $$...$$ (display math)
 * - Escapes currency patterns like $5, $10, $1.50 to prevent parsing as math
 * Preserves code blocks and avoids touching content inside them.
 */
export function normalizeLatexDelimiters(content: string): string {
  const codeBlocks: string[] = []
  let preserved = content.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    codeBlocks.push(match)
    return `\x00CODE_BLOCK_${codeBlocks.length - 1}\x00`
  })

  // Convert \[...\] to $$...$$ (display math)
  preserved = preserved.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$${math}$$`)

  // Convert \(...\) to $...$ (inline math)
  preserved = preserved.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math}$`)

  // Escape currency patterns: $5, $10, $1.50, $1,000, etc.
  // Match $ followed by digits (with optional decimal/comma separators) when not already escaped
  // This prevents "$5 and $10" from being treated as "$5 and $" math expression
  preserved = preserved.replace(/(?<!\\)\$(\d[\d,]*(?:\.\d+)?)/g, (_, num) => `\\$${num}`)

  // Restore code blocks
  preserved = preserved.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_, index) => codeBlocks[Number(index)])

  return preserved
}
