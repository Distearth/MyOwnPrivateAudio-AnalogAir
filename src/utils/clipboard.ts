/**
 * Cross-environment clipboard copy utility.
 * Supports:
 * 1. Modern Async Clipboard API (navigator.clipboard.writeText)
 * 2. Range / span element selection (Feross clipboard-copy technique)
 * 3. In-viewport offscreen textarea selection (GitHub clipboard technique)
 * 4. Fallback prompt (window.prompt) for sandbox/iframe/policy restricted environments
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern navigator.clipboard (requires HTTPS or localhost in modern browsers)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard.writeText blocked or failed:', err);
    }
  }

  // 2. Try DOM span element selection with userSelect: 'all' (effective across HTTP LAN & mobile browsers)
  try {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.whiteSpace = 'pre';
    span.style.position = 'fixed';
    span.style.top = '0';
    span.style.left = '0';
    span.style.opacity = '0.01';
    span.style.pointerEvents = 'none';
    span.style.webkitUserSelect = 'auto';
    span.style.userSelect = 'all';

    document.body.appendChild(span);

    const selection = window.getSelection();
    const range = window.document.createRange();
    if (selection) {
      selection.removeAllRanges();
      range.selectNode(span);
      selection.addRange(range);
    }

    let success = false;
    try {
      success = window.document.execCommand('copy');
    } finally {
      if (selection) {
        selection.removeAllRanges();
      }
      if (document.body.contains(span)) {
        document.body.removeChild(span);
      }
    }

    if (success) {
      return true;
    }
  } catch (err) {
    console.warn('Span selection copy failed:', err);
  }

  // 3. Try visible 1px textarea selection (GitHub clipboard technique)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.opacity = '0.01';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, text.length);

    let success = false;
    try {
      success = window.document.execCommand('copy');
    } finally {
      if (document.body.contains(textArea)) {
        document.body.removeChild(textArea);
      }
    }

    if (success) {
      return true;
    }
  } catch (err) {
    console.warn('Textarea copy failed:', err);
  }

  // 4. Last-resort fallback for sandboxed/restricted iframe browsers
  try {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      window.prompt('Copy command (Ctrl+C / Cmd+C, then Enter):', text);
      return true;
    }
  } catch (err) {
    console.error('Prompt fallback failed:', err);
  }

  return false;
}
